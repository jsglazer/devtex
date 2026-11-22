import { describe, expect, it, vi } from 'vitest';
import { bodyRange, splitBlocks } from './blocks.js';
import { Debouncer } from './debounce.js';
import { engineOf, parseMagicComments, setDevTexMagic } from './magic.js';
import { collectMacros, macroSetHash, toMathJaxMacros, toParserSignatures } from './macros.js';
import {
  findIncludes,
  includeClosure,
  missingIncludes,
  preambleOf,
  resolveRoot,
} from './project.js';
import { bestInnerLine, findBlockForLine, sourceTargetFromAttributes } from './sourcemap.js';
import { joinPath, maskNonCode, normalizePath, relativePath } from './text.js';
import type { Scheduler } from './bbt.js';

describe('text utils', () => {
  it('masks comments but keeps escaped percent and offsets', () => {
    const t = 'a \\% b % c\nd';
    const m = maskNonCode(t);
    expect(m.length).toBe(t.length);
    expect(m).toBe('a \\% b    \nd');
  });
  it('normalizes and relativizes POSIX paths', () => {
    expect(normalizePath('a/./b/../c//d')).toBe('a/c/d');
    expect(joinPath('chapters', '../main.tex')).toBe('main.tex');
    expect(relativePath('paper', 'paper/ch/a.tex')).toBe('ch/a.tex');
    expect(relativePath('.', 'a.tex')).toBe('a.tex');
  });
});

describe('magic comments', () => {
  const t =
    '% !TEX root = ../main.tex\n% !TEX program = XeLaTeX\n% !DevTex git = papers/thesis/\n% !DevTex submitstamp = v2\n\\section{x}\n% !DevTex pushed = late-ignored';
  it('parses the header only', () => {
    expect(parseMagicComments(t)).toEqual({
      root: '../main.tex',
      program: 'xelatex',
      git: 'papers/thesis/',
      submitstamp: 'v2',
    });
    expect(engineOf(parseMagicComments(t))).toBe('xelatex');
    expect(engineOf({})).toBe('pdflatex');
    expect(engineOf({ program: 'context' })).toBe('pdflatex');
  });
  it('sets or inserts DevTex magic lines', () => {
    const a = setDevTexMagic(t, 'pushed', '20261122-101500');
    expect(a.split('\n')[4]).toBe('% !DevTex pushed = 20261122-101500');
    const b = setDevTexMagic(a, 'pushed', '20261123-000000');
    expect(b.split('\n')[4]).toBe('% !DevTex pushed = 20261123-000000');
    expect(setDevTexMagic('\\documentclass{x}', 'git', 'p/')).toBe(
      '% !DevTex git = p/\n\\documentclass{x}',
    );
  });
});

describe('project graph and root resolution', () => {
  const files = new Map([
    [
      'thesis/main.tex',
      '\\documentclass{report}\n\\begin{document}\n\\include{chapters/one}\n% \\input{chapters/commented}\n\\input{chapters/two.tex}\n\\end{document}',
    ],
    ['thesis/chapters/one.tex', 'One \\input{chapters/nested}'],
    ['thesis/chapters/two.tex', 'Two'],
    ['thesis/chapters/nested.tex', 'Nested \\input{chapters/one}'],
    ['thesis/chapters/magic.tex', '% !TEX root = ../main.tex\nMagic'],
    ['other/solo.tex', 'Solo'],
  ]);
  it('finds includes (ignoring comments) relative to the root folder', () => {
    expect(
      findIncludes(files.get('thesis/main.tex') ?? '', 'thesis').map((i) => [i.target, i.line]),
    ).toEqual([
      ['thesis/chapters/one.tex', 3],
      ['thesis/chapters/two.tex', 5],
    ]);
  });
  it('computes a cycle-safe include closure', () => {
    expect(includeClosure('thesis/main.tex', files)).toEqual([
      'thesis/main.tex',
      'thesis/chapters/one.tex',
      'thesis/chapters/nested.tex',
      'thesis/chapters/two.tex',
    ]);
    expect(missingIncludes('m.tex', new Map([['m.tex', '\\input{gone}']]))).toEqual(['gone.tex']);
  });
  it('resolves the root by magic comment, self, graph, or fallback', () => {
    expect(resolveRoot('thesis/chapters/magic.tex', files)).toEqual({
      root: 'thesis/main.tex',
      source: 'magic',
    });
    expect(resolveRoot('thesis/main.tex', files)).toEqual({
      root: 'thesis/main.tex',
      source: 'self',
    });
    expect(resolveRoot('thesis/chapters/nested.tex', files)).toEqual({
      root: 'thesis/main.tex',
      source: 'graph',
    });
    expect(resolveRoot('other/solo.tex', files)).toEqual({
      root: 'other/solo.tex',
      source: 'fallback',
    });
  });
  it('extracts the preamble', () => {
    expect(preambleOf(files.get('thesis/main.tex') ?? '')).toBe('\\documentclass{report}\n');
  });
});

describe('macro collection', () => {
  it('collects newcommand (with optional arg), DeclareMathOperator and argument-free def', () => {
    const m = collectMacros([
      '\\newcommand{\\R}{\\mathbb{R}}\\newcommand\\pair[2][x]{(#1,#2)}\\DeclareMathOperator*{\\argmax}{arg\\,max}\\def\\iid{i.i.d.}\\def\\withargs#1{no}',
      '\\renewcommand{\\R}{\\mathbf{R}} % \\newcommand{\\commented}{x}',
    ]);
    expect([...m.keys()].sort()).toEqual(['R', 'argmax', 'iid', 'pair']);
    expect(m.get('R')?.body).toBe('\\mathbf{R}');
    expect(m.get('pair')).toMatchObject({ arity: 2, optionalDefault: 'x', body: '(#1,#2)' });
    expect(toMathJaxMacros(m)['pair']).toEqual(['(#1,#2)', 2, 'x']);
    expect(toMathJaxMacros(m)['argmax']).toBe('\\operatorname*{arg\\,max}');
    expect(toParserSignatures(m)).toEqual({ pair: { signature: 'o m' } });
    expect(macroSetHash(m)).toBe(
      macroSetHash(
        collectMacros([
          ...[''],
          '\\def\\iid{i.i.d.}\\DeclareMathOperator*{\\argmax}{arg\\,max}\\newcommand\\pair[2][x]{(#1,#2)}\\newcommand{\\R}{\\mathbf{R}}',
        ]),
      ),
    );
  });
});

describe('block splitting', () => {
  it('splits at blank lines, headings, top-level environments and includes', () => {
    const t = [
      '\\documentclass{article}', // 1
      '\\begin{document}', // 2
      '\\section{A}', // 3
      'Para one', // 4
      'continues % comment', // 5
      '', // 6
      '\\begin{itemize}', // 7
      '\\item x', // 8
      '', // 9 (blank inside env does not split)
      '\\item y', // 10
      '\\end{itemize}', // 11
      'Text with $a', // 12
      '', // 13
      'b$ and \\[ x', // 14
      '\\] done', // 15
      '\\input{chap}', // 16
      '\\end{document}', // 17
    ].join('\n');
    const bs = splitBlocks('f.tex', t);
    expect(bs.map((b) => [b.kind, b.startLine, b.endLine])).toEqual([
      ['heading', 3, 3],
      ['paragraph', 4, 5],
      ['environment', 7, 11],
      ['paragraph', 12, 12],
      ['paragraph', 14, 15],
      ['include', 16, 16],
    ]);
    expect(bs[5]?.includeArg).toBe('chap');
    expect(bs[2]?.env).toBe('itemize');
    expect(bodyRange(t.split('\n'))).toEqual({ first: 3, last: 16 });
  });

  it('gives identical content the same hash regardless of position', () => {
    const a = splitBlocks('f.tex', 'Same.\n\nOther.\n\nSame.');
    expect(a[0]?.hash).toBe(a[2]?.hash);
    expect(a[0]?.hash).not.toBe(a[1]?.hash);
  });
});

describe('source map helpers', () => {
  const blocks = [
    { id: 'a', file: 'x.tex', startLine: 1, endLine: 3 },
    { id: 'b', file: 'x.tex', startLine: 5, endLine: 9 },
    { id: 'c', file: 'y.tex', startLine: 1, endLine: 2 },
  ];
  it('finds the containing or nearest block', () => {
    expect(findBlockForLine(blocks, 'x.tex', 2)?.id).toBe('a');
    expect(findBlockForLine(blocks, 'x.tex', 4)?.id).toBe('b');
    expect(findBlockForLine(blocks, 'x.tex', 99)?.id).toBe('b');
    expect(findBlockForLine(blocks, 'z.tex', 1)).toBeUndefined();
    expect(bestInnerLine([5, 6, 8], 7)).toBe(6);
  });
  it('reads source targets from innermost-first attribute chains', () => {
    expect(sourceTargetFromAttributes([{ line: '7' }, { line: '5', file: 'x.tex' }])).toEqual({
      file: 'x.tex',
      line: 7,
    });
    expect(sourceTargetFromAttributes([{ line: null }])).toBeUndefined();
  });
});

describe('Debouncer (fake timers)', () => {
  it('coalesces pushes and fires once with the latest value after the delay', () => {
    vi.useFakeTimers();
    try {
      const fired: number[] = [];
      const sched: Scheduler = {
        now: () => Date.now(),
        schedule: (f, ms) => setTimeout(f, ms),
        cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      };
      const d = new Debouncer<number>(sched, 120, (v) => fired.push(v));
      d.push(1);
      vi.advanceTimersByTime(100);
      d.push(2);
      vi.advanceTimersByTime(100);
      expect(fired).toEqual([]);
      vi.advanceTimersByTime(20);
      expect(fired).toEqual([2]);
      d.push(3);
      d.flush();
      expect(fired).toEqual([2, 3]);
      d.push(4);
      d.cancel();
      vi.advanceTimersByTime(500);
      expect(fired).toEqual([2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });
});
