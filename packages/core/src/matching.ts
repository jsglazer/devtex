/**
 * Bracket and environment matching on comment/verbatim-masked text.
 * Produces matched \begin/\end pairs (for highlighting the pair at the
 * cursor and folding) and problems for broken code: mismatched or unclosed
 * environments, unbalanced braces, \left/\right and \[ \] mismatches.
 */
import { isEscaped, maskNonCode } from './text.js';

export interface Range {
  from: number;
  to: number;
}

export interface EnvPair {
  name: string;
  begin: Range;
  end: Range;
}

export type ProblemKind =
  | 'unclosed-env'
  | 'unopened-env'
  | 'mismatched-env'
  | 'unbalanced-brace'
  | 'unbalanced-leftright'
  | 'unbalanced-display';

export interface StructureProblem {
  kind: ProblemKind;
  from: number;
  to: number;
  message: string;
}

export interface StructureAnalysis {
  pairs: EnvPair[];
  problems: StructureProblem[];
}

interface Open {
  name: string;
  range: Range;
}

export function analyzeStructure(text: string): StructureAnalysis {
  const masked = maskNonCode(text);
  const pairs: EnvPair[] = [];
  const problems: StructureProblem[] = [];

  // environments
  const stack: Open[] = [];
  for (const m of masked.matchAll(/\\(begin|end)\s*\{([^}\n]*)\}/g)) {
    const kind = m[1];
    const name = m[2] ?? '';
    const range = { from: m.index, to: m.index + m[0].length };
    if (kind === 'begin') {
      stack.push({ name, range });
      continue;
    }
    const top = stack[stack.length - 1];
    if (top === undefined) {
      problems.push({
        kind: 'unopened-env',
        ...range,
        message: `\\end{${name}} has no matching \\begin`,
      });
      continue;
    }
    if (top.name === name) {
      stack.pop();
      pairs.push({ name, begin: top.range, end: range });
      continue;
    }
    // mismatch: if an outer open env matches, the inner ones are unclosed
    const idx = findLastIndex(stack, (o) => o.name === name);
    if (idx >= 0) {
      while (stack.length > idx + 1) {
        const o = stack.pop();
        if (o)
          problems.push({
            kind: 'unclosed-env',
            ...o.range,
            message: `\\begin{${o.name}} is not closed`,
          });
      }
      const o = stack.pop();
      if (o) pairs.push({ name, begin: o.range, end: range });
    } else {
      problems.push({
        kind: 'mismatched-env',
        ...range,
        message: `\\end{${name}} does not match \\begin{${top.name}}`,
      });
    }
  }
  for (const o of stack)
    problems.push({
      kind: 'unclosed-env',
      ...o.range,
      message: `\\begin{${o.name}} is not closed`,
    });

  // braces
  const braces: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c !== '{' && c !== '}') continue;
    if (isEscaped(masked, i)) continue;
    if (c === '{') braces.push(i);
    else if (braces.pop() === undefined) {
      problems.push({
        kind: 'unbalanced-brace',
        from: i,
        to: i + 1,
        message: 'Unmatched closing brace }',
      });
    }
  }
  for (const i of braces)
    problems.push({ kind: 'unbalanced-brace', from: i, to: i + 1, message: 'Unclosed brace {' });

  // \left / \right
  const lr: number[] = [];
  for (const m of masked.matchAll(/\\(left|right)(?![A-Za-z])/g)) {
    if (m[1] === 'left') lr.push(m.index);
    else if (lr.pop() === undefined) {
      problems.push({
        kind: 'unbalanced-leftright',
        from: m.index,
        to: m.index + 6,
        message: '\\right without \\left',
      });
    }
  }
  for (const i of lr)
    problems.push({
      kind: 'unbalanced-leftright',
      from: i,
      to: i + 5,
      message: '\\left without \\right',
    });

  // \[ \]
  let disp: number | null = null;
  for (const m of masked.matchAll(/\\(\[|\])/g)) {
    if (isEscaped(masked, m.index)) continue;
    if (m[1] === '[') {
      if (disp !== null)
        problems.push({
          kind: 'unbalanced-display',
          from: disp,
          to: disp + 2,
          message: '\\[ is not closed',
        });
      disp = m.index;
    } else if (disp === null) {
      problems.push({
        kind: 'unbalanced-display',
        from: m.index,
        to: m.index + 2,
        message: '\\] without \\[',
      });
    } else {
      disp = null;
    }
  }
  if (disp !== null)
    problems.push({
      kind: 'unbalanced-display',
      from: disp,
      to: disp + 2,
      message: '\\[ is not closed',
    });

  problems.sort((a, b) => a.from - b.from);
  return { pairs, problems };
}

function findLastIndex<T>(arr: readonly T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== undefined && pred(v)) return i;
  }
  return -1;
}

/** Innermost environment pair whose \begin or \end tag contains `pos`. */
export function pairAtTag(pairs: readonly EnvPair[], pos: number): EnvPair | undefined {
  return pairs.find(
    (p) => (pos >= p.begin.from && pos <= p.begin.to) || (pos >= p.end.from && pos <= p.end.to),
  );
}

/** Innermost environment pair enclosing `pos` (between its tags). */
export function enclosingPair(
  pairs: readonly EnvPair[],
  pos: number,
  names?: ReadonlySet<string>,
): EnvPair | undefined {
  let best: EnvPair | undefined;
  for (const p of pairs) {
    if (names !== undefined && !names.has(p.name)) continue;
    if (pos >= p.begin.to && pos <= p.end.from) {
      if (best === undefined || p.begin.from > best.begin.from) best = p;
    }
  }
  return best;
}
