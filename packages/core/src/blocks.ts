/**
 * Split a .tex file into preview blocks at paragraph and top-level
 * environment boundaries. Each block records its file and 1-based line span
 * so the renderer can emit data-source-file / data-source-line /
 * data-source-end-line, and a content hash so unchanged blocks are served
 * from cache.
 */
import { hashString } from './hash.js';
import { maskNonCode } from './text.js';

export type BlockKind = 'paragraph' | 'environment' | 'heading' | 'display' | 'include';

export interface SourceBlock {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  kind: BlockKind;
  /** hash of kind + text (not of position), so moved blocks stay cached. */
  hash: string;
  /** For kind 'include': the raw \input/\include argument. */
  includeArg?: string;
  /** Top-level environment name for kind 'environment'. */
  env?: string;
}

const HEADING_RE =
  /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const INCLUDE_LINE_RE = /^\s*\\(?:input|include|subfile)\s*\{([^}]+)\}\s*$/;
const BEGIN_LINE_RE = /^\s*\\begin\s*\{([^}]+)\}/;

function envDelta(masked: string): number {
  let d = 0;
  for (const m of masked.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    if (m[2] === 'document') continue;
    d += m[1] === 'begin' ? 1 : -1;
  }
  return d;
}

/** Net change in display-math (\[ … \]) nesting on a line. */
function displayDelta(masked: string): number {
  let d = 0;
  for (const m of masked.matchAll(/\\(\[|\])/g)) d += m[1] === '[' ? 1 : -1;
  return d;
}

function braceDelta(masked: string): number {
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') d++;
    else if (c === '}') d--;
  }
  return d;
}

/** Line range [first,last] (1-based, inclusive) of the document body. */
export function bodyRange(maskedLines: readonly string[]): { first: number; last: number } {
  let first = 1;
  let last = maskedLines.length;
  for (let i = 0; i < maskedLines.length; i++) {
    if (/\\begin\s*\{document\}/.test(maskedLines[i] ?? '')) {
      first = i + 2;
      break;
    }
  }
  for (let i = maskedLines.length - 1; i >= 0; i--) {
    if (/\\end\s*\{document\}/.test(maskedLines[i] ?? '')) {
      last = i;
      break;
    }
  }
  return { first, last };
}

export function splitBlocks(file: string, text: string): SourceBlock[] {
  const lines = text.split('\n');
  const masked = maskNonCode(text).split('\n');
  const { first, last } = bodyRange(masked);
  const blocks: SourceBlock[] = [];

  let cur: { start: number; lines: string[]; kind: BlockKind; env?: string } | null = null;
  let envDepth = 0;
  let dispDepth = 0;
  let braces = 0;

  const flush = (endLine: number): void => {
    if (!cur) return;
    // trim trailing comment-only/blank lines from the block span
    let end = endLine;
    while (end > cur.start && (masked[end - 1] ?? '').trim() === '') {
      cur.lines.pop();
      end--;
    }
    const body = cur.lines.join('\n');
    const block: SourceBlock = {
      file,
      startLine: cur.start,
      endLine: end,
      text: body,
      kind: cur.kind,
      hash: hashString(`${cur.kind}\u0000${body}`),
    };
    if (cur.env !== undefined) block.env = cur.env;
    if (cur.kind === 'include') {
      const m = INCLUDE_LINE_RE.exec(body);
      if (m?.[1] !== undefined) block.includeArg = m[1];
    }
    blocks.push(block);
    cur = null;
    envDepth = 0;
    dispDepth = 0;
    braces = 0;
  };

  for (let ln = first; ln <= last; ln++) {
    const raw = lines[ln - 1] ?? '';
    const m = masked[ln - 1] ?? '';
    const open = envDepth > 0 || dispDepth > 0 || braces > 0;

    if (!open) {
      if (raw.trim() === '') {
        flush(ln - 1);
        continue;
      }
      if (m.trim() === '') {
        // comment-only line: keep inside an open paragraph, never start one
        if (cur) cur.lines.push(raw);
        continue;
      }
      if (cur && cur.kind !== 'paragraph') flush(ln - 1);
      const inc = INCLUDE_LINE_RE.exec(m);
      const begin = BEGIN_LINE_RE.exec(m);
      const heading = HEADING_RE.test(m);
      const display = /^\s*\\\[/.test(m);
      if (inc || begin || heading || display) {
        flush(ln - 1);
        const kind: BlockKind = inc
          ? 'include'
          : heading
            ? 'heading'
            : begin
              ? 'environment'
              : 'display';
        cur = { start: ln, lines: [], kind };
        if (kind === 'environment' && begin?.[1] !== undefined) cur.env = begin[1];
      } else if (!cur) {
        cur = { start: ln, lines: [], kind: 'paragraph' };
      }
    }

    if (!cur) cur = { start: ln, lines: [], kind: 'paragraph' };
    cur.lines.push(raw);
    envDepth = Math.max(0, envDepth + envDelta(m));
    dispDepth = Math.max(0, dispDepth + displayDelta(m));
    braces = Math.max(0, braces + braceDelta(m));

    const nowOpen = envDepth > 0 || dispDepth > 0 || braces > 0;
    if (!nowOpen && cur.kind !== 'paragraph') flush(ln);
  }
  flush(last);
  return blocks;
}
