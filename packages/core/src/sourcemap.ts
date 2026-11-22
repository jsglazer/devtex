/**
 * Source <-> HTML preview mapping. The preview emits data-source-file /
 * data-source-line / data-source-end-line on every block and data-source-line
 * on inner elements (headings, list items, table rows, display math). These
 * pure helpers choose the best target; the UI only reads attributes and
 * scrolls/highlights.
 */

export interface BlockSpan {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * Block that contains (file, line); else the nearest block in the same file
 * (following block preferred, e.g. for a blank line between paragraphs).
 */
export function findBlockForLine<T extends BlockSpan>(
  blocks: readonly T[],
  file: string,
  line: number,
): T | undefined {
  let before: T | undefined;
  let after: T | undefined;
  for (const b of blocks) {
    if (b.file !== file) continue;
    if (line >= b.startLine && line <= b.endLine) return b;
    if (b.endLine < line && (before === undefined || b.endLine > before.endLine)) before = b;
    if (b.startLine > line && (after === undefined || b.startLine < after.startLine)) after = b;
  }
  return after ?? before;
}

/** Inner element line to highlight: the greatest candidate <= line. */
export function bestInnerLine(candidates: readonly number[], line: number): number | undefined {
  let best: number | undefined;
  for (const c of candidates) if (c <= line && (best === undefined || c > best)) best = c;
  return best;
}

/** Source target for a click inside the preview (innermost attributes first). */
export function sourceTargetFromAttributes(
  chain: readonly { file?: string | null; line?: string | null }[],
): { file: string; line: number } | undefined {
  let line: number | undefined;
  for (const el of chain) {
    if (line === undefined && el.line !== undefined && el.line !== null) {
      const n = Number.parseInt(el.line, 10);
      if (Number.isFinite(n)) line = n;
    }
    if (el.file !== undefined && el.file !== null && line !== undefined)
      return { file: el.file, line };
  }
  return undefined;
}
