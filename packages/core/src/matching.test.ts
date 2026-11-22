import { describe, expect, it } from 'vitest';
import { analyzeStructure, enclosingPair, pairAtTag } from './matching.js';

describe('analyzeStructure', () => {
  it('pairs nested environments', () => {
    const t = '\\begin{a}\\begin{b}x\\end{b}\\end{a}';
    const { pairs, problems } = analyzeStructure(t);
    expect(problems).toEqual([]);
    expect(pairs.map((p) => p.name)).toEqual(['b', 'a']);
    expect(pairAtTag(pairs, t.indexOf('\\end{a}') + 2)?.name).toBe('a');
    expect(enclosingPair(pairs, t.indexOf('x'))?.name).toBe('b');
  });

  it('detects a mismatched \\end', () => {
    const { problems } = analyzeStructure('\\begin{itemize}\n\\item x\n\\end{enumerate}');
    expect(problems).toHaveLength(2);
    expect(problems.map((p) => p.kind)).toEqual(['unclosed-env', 'mismatched-env']);
    expect(problems[1]?.message).toContain('does not match \\begin{itemize}');
  });

  it('detects unclosed inner env when an outer \\end matches', () => {
    const t = '\\begin{figure}\\begin{center}x\\end{figure}';
    const { problems, pairs } = analyzeStructure(t);
    expect(problems).toEqual([
      { kind: 'unclosed-env', from: 14, to: 28, message: '\\begin{center} is not closed' },
    ]);
    expect(pairs[0]?.name).toBe('figure');
  });

  it('detects \\end without \\begin', () => {
    expect(analyzeStructure('x \\end{quote}').problems[0]?.kind).toBe('unopened-env');
  });

  it('ignores environments and braces in comments and verbatim', () => {
    const t =
      '% \\begin{itemize} {\n\\verb|{|\n\\begin{verbatim}\n\\end{itemize} }\n\\end{verbatim}\nok \\{ \\}';
    expect(analyzeStructure(t).problems).toEqual([]);
  });

  it('detects unbalanced braces, \\left/\\right and \\[ \\]', () => {
    const kinds = (t: string): string[] => analyzeStructure(t).problems.map((p) => p.kind);
    expect(kinds('\\textbf{x')).toEqual(['unbalanced-brace']);
    expect(kinds('x}')).toEqual(['unbalanced-brace']);
    expect(kinds('$\\left( x $')).toEqual(['unbalanced-leftright']);
    expect(kinds('$\\left( x \\right] $')).toEqual([]);
    expect(kinds('\\[ x')).toEqual(['unbalanced-display']);
    expect(kinds('x \\]')).toEqual(['unbalanced-display']);
  });
});
