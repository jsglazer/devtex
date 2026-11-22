/**
 * Incremental HTML preview renderer. Runs inside the preview Web Worker.
 *
 * On every update it re-splits the project into blocks (cheap, linear), then
 * re-parses and re-renders ONLY blocks whose (file, content hash, macro-set
 * hash) is not in the cache. Cached templates hold block-relative line
 * markers, so a block that merely moved (lines inserted above it) is
 * re-materialized without re-parsing and reported as `moved` with a line
 * delta — the UI just shifts attributes instead of replacing DOM.
 *
 * Math is typeset only for dirty blocks of an incremental edit and for the
 * first `initialTypesetBlocks` blocks of a cold render; other blocks keep
 * pending math slots until the UI reports them visible (`typesetPending`).
 * There is never a synchronous full-document re-typeset.
 */
import { splitBlocks, type SourceBlock } from '../blocks.js';
import { collectMacros, macroSetHash, type MacroSet } from '../macros.js';
import { dirname, escapeHtml } from '../text.js';
import { includeClosure, resolveIncludePath, type FileMap } from '../project.js';
import {
  errorBlockTemplate,
  LINE_CLOSE,
  LINE_OPEN,
  makeParser,
  MATH_CLOSE,
  MATH_OPEN,
  renderBlockTemplate,
  type BlockTemplate,
  type Parser,
} from './html.js';
import type { MathRenderer } from './mathjax.js';

export interface ProjectSnapshot {
  /** Project-relative path of the root document. */
  root: string;
  files: FileMap;
}

export interface RenderedBlock {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  html: string;
  mathPending: boolean;
}

export type BlockStatus = 'new' | 'moved' | 'same';

export interface BlockUpdate {
  id: string;
  status: BlockStatus;
  file: string;
  startLine: number;
  endLine: number;
  /** Present for 'new' blocks (and blocks whose math was just typeset). */
  html?: string;
  /** Line shift for 'moved' blocks. */
  lineDelta?: number;
  mathPending: boolean;
}

export interface RenderTimings {
  parseMs: number;
  renderMs: number;
  typesetMs: number;
  totalMs: number;
}

export interface RenderUpdate {
  /** Block ids in document order. */
  order: string[];
  /** Only blocks that are new or moved. */
  changes: BlockUpdate[];
  removed: string[];
  timings: RenderTimings;
  stats: { blocks: number; rerendered: number; typeset: number; unsupported: number };
}

export interface RendererDeps {
  math: MathRenderer;
  /** Monotonic clock in ms (injected; used only for the timing HUD). */
  now: () => number;
}

export interface RendererOptions {
  initialTypesetBlocks?: number;
  maxIncludeDepth?: number;
}

interface CacheEntry {
  template: BlockTemplate;
  mathHtml: (string | null)[];
}

interface Current {
  block: SourceBlock;
  key: string;
  startLine: number;
}

/** Replace line markers with absolute lines (startLine + rel). */
export function materializeLines(template: string, startLine: number): string {
  return template.replace(new RegExp(`${LINE_OPEN}(\\d+)${LINE_CLOSE}`, 'g'), (_m, d: string) =>
    String(startLine + Number(d)),
  );
}

function fillMath(template: string, mathHtml: readonly (string | null)[]): string {
  return template.replace(new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'), (_m, d: string) => {
    const h = mathHtml[Number(d)];
    return h ?? '<span class="dt-math-pending">…</span>';
  });
}

export class IncrementalRenderer {
  private readonly cache = new Map<string, CacheEntry>();
  private current = new Map<string, Current>();
  private order: string[] = [];
  private macroHash = '';
  private parser: Parser | null = null;
  private macros: MacroSet = new Map();
  private rendered = false;
  private readonly initialTypesetBlocks: number;
  private readonly maxIncludeDepth: number;

  constructor(
    private readonly deps: RendererDeps,
    opts: RendererOptions = {},
  ) {
    this.initialTypesetBlocks = opts.initialTypesetBlocks ?? 40;
    this.maxIncludeDepth = opts.maxIncludeDepth ?? 16;
  }

  /** Flattened blocks of the project in document order (includes spliced in). */
  private collectBlocks(snapshot: ProjectSnapshot): SourceBlock[] {
    const rootDir = dirname(snapshot.root);
    const out: SourceBlock[] = [];
    const visit = (file: string, stack: readonly string[]): void => {
      const text = snapshot.files.get(file);
      if (text === undefined) return;
      for (const b of splitBlocks(file, text)) {
        if (b.kind === 'include' && b.includeArg !== undefined) {
          const target = resolveIncludePath(rootDir, b.includeArg);
          if (
            snapshot.files.has(target) &&
            !stack.includes(target) &&
            stack.length < this.maxIncludeDepth
          ) {
            visit(target, [...stack, target]);
            continue;
          }
        }
        out.push(b);
      }
    };
    visit(snapshot.root, [snapshot.root]);
    return out;
  }

  private ensureMacros(snapshot: ProjectSnapshot): void {
    const texts = includeClosure(snapshot.root, snapshot.files).map(
      (f) => snapshot.files.get(f) ?? '',
    );
    const macros = collectMacros(texts);
    const h = macroSetHash(macros);
    if (this.parser === null || h !== this.macroHash) {
      this.macroHash = h;
      this.macros = macros;
      this.parser = makeParser(macros);
      this.deps.math.setMacros(macros);
    }
  }

  private typeset(entry: CacheEntry): number {
    let n = 0;
    entry.template.math.forEach((job, i) => {
      if (entry.mathHtml[i] === null || entry.mathHtml[i] === undefined) {
        try {
          entry.mathHtml[i] = this.deps.math.render(job.tex, job.display);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          entry.mathHtml[i] =
            `<span class="dt-math-error" title="${escapeHtml(msg)}">${escapeHtml(job.tex)}</span>`;
        }
        n++;
      }
    });
    return n;
  }

  private materialize(id: string, cur: Current, entry: CacheEntry): string {
    const html = materializeLines(fillMath(entry.template.html, entry.mathHtml), cur.startLine);
    return html.replace(
      '<div class="dt-block',
      `<div data-block-id="${escapeHtml(id)}" class="dt-block`,
    );
  }

  private pending(entry: CacheEntry): boolean {
    return entry.mathHtml.some((h) => h === null);
  }

  update(snapshot: ProjectSnapshot): RenderUpdate {
    const { now } = this.deps;
    const t0 = now();
    let parseMs = 0;
    let renderMs = 0;
    let typesetMs = 0;

    this.ensureMacros(snapshot);
    const parser = this.parser ?? makeParser(this.macros);
    const blocks = this.collectBlocks(snapshot);
    parseMs += now() - t0;

    const cold = !this.rendered;
    const next = new Map<string, Current>();
    const order: string[] = [];
    const changes: BlockUpdate[] = [];
    const occurrences = new Map<string, number>();
    const usedKeys = new Set<string>();
    let rerendered = 0;
    let typesetCount = 0;
    let unsupported = 0;

    blocks.forEach((block, index) => {
      const key = `${block.file}\u0000${block.hash}\u0000${this.macroHash}`;
      const occ = occurrences.get(key) ?? 0;
      occurrences.set(key, occ + 1);
      const id = `${block.file}#${block.hash}#${occ}`;
      usedKeys.add(key);

      let entry = this.cache.get(key);
      let fresh = false;
      if (entry === undefined) {
        const tp = now();
        let template: BlockTemplate;
        try {
          const ast = parser.parse(block.text);
          const tr = now();
          parseMs += tr - tp;
          template = renderBlockTemplate(block, this.macros, parser, ast);
          renderMs += now() - tr;
        } catch (e) {
          template = errorBlockTemplate(block, e instanceof Error ? e.message : String(e));
          renderMs += now() - tp;
        }
        entry = { template, mathHtml: template.math.map(() => null) };
        this.cache.set(key, entry);
        rerendered++;
        fresh = true;
      }
      unsupported += entry.template.unsupported;

      const shouldTypeset = cold ? index < this.initialTypesetBlocks : fresh;
      if (shouldTypeset && this.pending(entry)) {
        const ts = now();
        typesetCount += this.typeset(entry);
        typesetMs += now() - ts;
      }

      const cur: Current = { block, key, startLine: block.startLine };
      next.set(id, cur);
      order.push(id);
      const prev = this.current.get(id);
      const base = {
        id,
        file: block.file,
        startLine: block.startLine,
        endLine: block.endLine,
        mathPending: this.pending(entry),
      };
      if (prev === undefined || fresh) {
        changes.push({ ...base, status: 'new', html: this.materialize(id, cur, entry) });
      } else if (prev.startLine !== block.startLine) {
        changes.push({ ...base, status: 'moved', lineDelta: block.startLine - prev.startLine });
      }
    });

    const removed = [...this.current.keys()].filter((id) => !next.has(id));
    this.current = next;
    this.order = order;
    this.rendered = true;

    if (this.cache.size > usedKeys.size * 2 + 256) {
      for (const k of this.cache.keys()) if (!usedKeys.has(k)) this.cache.delete(k);
    }

    return {
      order,
      changes,
      removed,
      timings: { parseMs, renderMs, typesetMs, totalMs: now() - t0 },
      stats: { blocks: blocks.length, rerendered, typeset: typesetCount, unsupported },
    };
  }

  /** Typeset deferred math for the given (visible) block ids. */
  typesetPending(ids: readonly string[]): BlockUpdate[] {
    const out: BlockUpdate[] = [];
    for (const id of ids) {
      const cur = this.current.get(id);
      if (cur === undefined) continue;
      const entry = this.cache.get(cur.key);
      if (entry === undefined || !this.pending(entry)) continue;
      this.typeset(entry);
      out.push({
        id,
        status: 'new',
        file: cur.block.file,
        startLine: cur.block.startLine,
        endLine: cur.block.endLine,
        html: this.materialize(id, cur, entry),
        mathPending: false,
      });
    }
    return out;
  }

  /** Ids of blocks that still have untypeset math, in document order. */
  pendingIds(): string[] {
    return this.order.filter((id) => {
      const cur = this.current.get(id);
      const entry = cur ? this.cache.get(cur.key) : undefined;
      return entry !== undefined && this.pending(entry);
    });
  }

  /** Current blocks with fully materialized HTML (tests / initial paint). */
  snapshot(): RenderedBlock[] {
    return this.order.flatMap((id) => {
      const cur = this.current.get(id);
      const entry = cur ? this.cache.get(cur.key) : undefined;
      if (cur === undefined || entry === undefined) return [];
      return [
        {
          id,
          file: cur.block.file,
          startLine: cur.block.startLine,
          endLine: cur.block.endLine,
          html: this.materialize(id, cur, entry),
          mathPending: this.pending(entry),
        },
      ];
    });
  }
}
