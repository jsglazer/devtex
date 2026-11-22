/**
 * Preview pane client. Posts changed files to the Web Worker (debounced; the
 * worker never re-renders on the UI thread), applies the worker's block
 * patches to the DOM (new blocks replaced, moved blocks just get their line
 * attributes shifted), reports visible blocks for deferred math, and handles
 * two-way sync via data-source-* attributes.
 */
import {
  bestInnerLine,
  Debouncer,
  findBlockForLine,
  sourceTargetFromAttributes,
  type BlockSpan,
  type Scheduler,
} from '@devtex/core';
import type { BlockUpdate, RenderTimings, RenderUpdate } from '@devtex/core/render';
import type { FromWorker, ToWorker } from '../worker/protocol.js';

export interface PreviewOptions {
  container: HTMLElement;
  debounceMs: number;
  onSourceClick(file: string, line: number): void;
  onTimings(t: RenderTimings, stats: RenderUpdate['stats']): void;
}

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class PreviewPane {
  private readonly worker: Worker;
  private readonly blocks = new Map<string, HTMLElement>();
  private spans: BlockSpan[] = [];
  private readonly sent = new Map<string, string>();
  private root = '';
  private debouncer: Debouncer<null>;
  private readonly observer: IntersectionObserver;
  private readonly visible = new Set<string>();
  private pendingMath = new Set<string>();
  private highlighted: HTMLElement | null = null;

  constructor(private readonly opts: PreviewOptions) {
    this.worker = new Worker(new URL('../worker/preview.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    this.debouncer = new Debouncer(browserScheduler, opts.debounceMs, () => this.flush());
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: opts.container,
      rootMargin: '400px 0px',
    });
    opts.container.addEventListener('click', (ev) => this.onClick(ev));
  }

  private post(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  private pendingFiles = new Map<string, string>();

  /** Queue the latest texts; only files that changed since the last post are sent. */
  update(root: string, files: ReadonlyMap<string, string>, immediate = false): void {
    if (root !== this.root) {
      this.root = root;
      this.sent.clear();
    }
    for (const [p, t] of files) if (this.sent.get(p) !== t) this.pendingFiles.set(p, t);
    this.debouncer.push(null);
    if (immediate) this.debouncer.flush();
  }

  private flush(): void {
    if (this.pendingFiles.size === 0 || this.root === '') return;
    const files = [...this.pendingFiles];
    for (const [p, t] of files) this.sent.set(p, t);
    this.pendingFiles.clear();
    this.post({ type: 'files', root: this.root, files });
  }

  reset(): void {
    this.post({ type: 'reset' });
    this.sent.clear();
    this.blocks.clear();
    this.spans = [];
    this.opts.container.replaceChildren();
  }

  private onMessage(m: FromWorker): void {
    if (m.type === 'rendered') this.apply(m.update);
    else if (m.type === 'typeset') this.patch(m.changes);
    else this.opts.container.dataset['error'] = m.message;
  }

  private createBlock(c: BlockUpdate): HTMLElement | null {
    const tpl = document.createElement('template');
    tpl.innerHTML = c.html ?? '';
    const node = tpl.content.firstElementChild;
    return node instanceof HTMLElement ? node : null;
  }

  private apply(u: RenderUpdate): void {
    const changes = new Map(u.changes.map((c) => [c.id, c]));
    for (const id of u.removed) {
      const node = this.blocks.get(id);
      if (node) {
        this.observer.unobserve(node);
        node.remove();
      }
      this.blocks.delete(id);
      this.pendingMath.delete(id);
    }
    const container = this.opts.container;
    let prev: Element | null = null;
    for (const id of u.order) {
      const c = changes.get(id);
      let node = this.blocks.get(id) ?? null;
      if (c?.status === 'new') {
        const fresh = this.createBlock(c);
        if (fresh) {
          if (node) {
            this.observer.unobserve(node);
            node.replaceWith(fresh);
          }
          node = fresh;
          this.blocks.set(id, node);
          this.observer.observe(node);
        }
        if (c.mathPending) this.pendingMath.add(id);
        else this.pendingMath.delete(id);
      } else if (c?.status === 'moved' && node && c.lineDelta !== undefined) {
        shiftLines(node, c.lineDelta);
      }
      if (node) {
        const expectedPrev: Element | null =
          prev === null ? container.firstElementChild : prev.nextElementSibling;
        if (expectedPrev !== node) {
          if (prev === null) container.prepend(node);
          else prev.after(node);
        }
        prev = node;
      }
    }
    this.spans = u.order.flatMap((id) => {
      const n = this.blocks.get(id);
      if (!n) return [];
      return [
        {
          id,
          file: n.dataset['sourceFile'] ?? '',
          startLine: Number(n.dataset['sourceLine']),
          endLine: Number(n.dataset['sourceEndLine']),
        },
      ];
    });
    this.requestVisibleMath();
    this.opts.onTimings(u.timings, u.stats);
  }

  private patch(changes: BlockUpdate[]): void {
    for (const c of changes) {
      const node = this.blocks.get(c.id);
      const fresh = this.createBlock(c);
      if (node && fresh) {
        this.observer.unobserve(node);
        node.replaceWith(fresh);
        this.blocks.set(c.id, fresh);
        this.observer.observe(fresh);
      }
      this.pendingMath.delete(c.id);
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
      const id = (e.target as HTMLElement).dataset['blockId'];
      if (id === undefined) continue;
      if (e.isIntersecting) this.visible.add(id);
      else this.visible.delete(id);
    }
    this.requestVisibleMath();
  }

  private requestVisibleMath(): void {
    const ids = [...this.visible].filter((id) => this.pendingMath.has(id));
    if (ids.length > 0) this.post({ type: 'visible', ids });
  }

  private onClick(ev: MouseEvent): void {
    let t = ev.target instanceof Element ? ev.target : null;
    const chain: { file?: string | null; line?: string | null }[] = [];
    while (t && t !== this.opts.container) {
      if (t instanceof HTMLElement)
        chain.push({
          file: t.dataset['sourceFile'] ?? null,
          line: t.dataset['sourceLine'] ?? null,
        });
      t = t.parentElement;
    }
    const target = sourceTargetFromAttributes(chain);
    if (target) {
      this.highlightElement(
        ev.target instanceof Element ? ev.target.closest('[data-source-line]') : null,
      );
      this.opts.onSourceClick(target.file, target.line);
    }
  }

  private highlightElement(node: Element | null): void {
    this.highlighted?.classList.remove('dt-sync-highlight');
    if (node instanceof HTMLElement) {
      node.classList.add('dt-sync-highlight');
      this.highlighted = node;
    }
  }

  /** Source -> preview: highlight and reveal the element for (file, line). */
  reveal(file: string, line: number, scroll = true): void {
    const span = findBlockForLine(this.spans, file, line);
    if (span === undefined) return;
    const block = this.blocks.get(span.id);
    if (!block) return;
    const inner = [...block.querySelectorAll<HTMLElement>('[data-source-line]')];
    const best = bestInnerLine(
      inner.map((n) => Number(n.dataset['sourceLine'])),
      line,
    );
    const target = inner.find((n) => Number(n.dataset['sourceLine']) === best) ?? block;
    this.highlightElement(target);
    if (scroll) {
      const c = this.opts.container.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      if (r.top < c.top || r.bottom > c.bottom)
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  setDebounce(ms: number): void {
    this.debouncer.flush();
    this.debouncer = new Debouncer(browserScheduler, ms, () => this.flush());
  }
}

function shiftLines(node: HTMLElement, delta: number): void {
  const shift = (el: HTMLElement, key: 'sourceLine' | 'sourceEndLine'): void => {
    const v = el.dataset[key];
    if (v !== undefined) el.dataset[key] = String(Number(v) + delta);
  };
  shift(node, 'sourceLine');
  shift(node, 'sourceEndLine');
  for (const el of node.querySelectorAll<HTMLElement>('[data-source-line]'))
    shift(el, 'sourceLine');
  for (const el of node.querySelectorAll<HTMLElement>('.dt-unsupported-line')) {
    el.textContent = (el.textContent ?? '').replace(/\d+/, (d) => String(Number(d) + delta));
  }
}
