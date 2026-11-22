import { describe, expect, it } from 'vitest';
import { decideExternalChange, lineDiff } from './conflict.js';
import {
  formatPushedStamp,
  normalizeRepoFolder,
  pdfPathFor,
  planPush,
  reviewCommitMessage,
  submitCommitMessage,
  withPushedStamp,
  withRepoFolder,
} from './push.js';

describe('external-change decisions', () => {
  const known = { mtimeMs: 1000, hash: 'aaa' };
  it('same content (even with a new mtime) is no change', () => {
    expect(decideExternalChange(known, { mtimeMs: 2000, hash: 'aaa' }, true)).toEqual({
      kind: 'none',
    });
  });
  it('clean buffer reloads silently; dirty buffer prompts', () => {
    expect(decideExternalChange(known, { mtimeMs: 2000, hash: 'bbb' }, false)).toEqual({
      kind: 'reload',
    });
    expect(decideExternalChange(known, { mtimeMs: 2000, hash: 'bbb' }, true)).toEqual({
      kind: 'conflict',
    });
  });
  it('deleted file is reported', () => {
    expect(decideExternalChange(known, null, true)).toEqual({ kind: 'deleted', dirty: true });
  });
  it('line diff marks removed and added lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'B' },
      { op: ' ', text: 'c' },
      { op: '+', text: 'd' },
    ]);
  });
});

describe('push planning (markup-reviewer conventions)', () => {
  const files = new Map([
    [
      'paper/main.tex',
      '% !DevTex git = reviews/paper\n\\begin{document}\n\\input{sections/intro}\n\\include{sections/method}\n\\end{document}',
    ],
    ['paper/sections/intro.tex', 'Intro'],
    ['paper/sections/method.tex', 'Method'],
    ['paper/unrelated.tex', 'Not included'],
  ]);

  it('formats the pushed stamp as YYYYMMDD-HHMMSS', () => {
    expect(formatPushedStamp({ year: 2026, month: 3, day: 7, hour: 9, minute: 5, second: 1 })).toBe(
      '20260307-090501',
    );
  });

  it('plans root + all includes + PDF under the repo folder', () => {
    const plan = planPush('paper/main.tex', files, pdfPathFor('paper/main.tex'), 'Research/paper');
    expect(plan).toEqual({
      ok: true,
      repoFolder: 'reviews/paper/',
      entries: [
        { localPath: 'paper/main.tex', repoPath: 'reviews/paper/main.tex', binary: false },
        {
          localPath: 'paper/sections/intro.tex',
          repoPath: 'reviews/paper/sections/intro.tex',
          binary: false,
        },
        {
          localPath: 'paper/sections/method.tex',
          repoPath: 'reviews/paper/sections/method.tex',
          binary: false,
        },
        { localPath: 'paper/main.pdf', repoPath: 'reviews/paper/main.pdf', binary: true },
      ],
    });
  });

  it('omits the PDF when not built', () => {
    const plan = planPush('paper/main.tex', files, null, 'x');
    expect(plan.ok && plan.entries.some((e) => e.binary)).toBe(false);
  });

  it('asks for a folder (suggesting the vault-relative one) when git is absent', () => {
    const f = new Map([['p/main.tex', '\\begin{document}\\end{document}']]);
    expect(planPush('p/main.tex', f, null, 'Research/p')).toEqual({
      ok: false,
      needsFolder: true,
      suggestedFolder: 'Research/p/',
    });
  });

  it('builds review and submit messages; submit aborts without submitstamp', () => {
    expect(reviewCommitMessage('paper/main.tex', '20261122-101500')).toBe(
      'Review: main.tex 20261122-101500',
    );
    expect(submitCommitMessage('% !DevTex submitstamp = R&R-2\nx')).toEqual({
      ok: true,
      message: 'Submitted version R&R-2',
    });
    const missing = submitCommitMessage('x');
    expect(missing.ok).toBe(false);
  });

  it('records stamp and folder as magic comments', () => {
    const t = withPushedStamp(withRepoFolder('\\documentclass{a}', '/a/b'), '20261122-101500');
    expect(t).toBe('% !DevTex git = a/b/\n% !DevTex pushed = 20261122-101500\n\\documentclass{a}');
    expect(normalizeRepoFolder('')).toBe('');
  });
});
