/**
 * Performance/regression gate for the incremental HTML renderer on a fixed
 * 2,500+ line, 9-file fixture (root + 8 \include chapters):
 *   - a single-block edit re-renders in < 250 ms (parse + render + typeset),
 *   - only the edited block is re-rendered,
 *   - every block carries accurate data-source-file / data-source-line /
 *     data-source-end-line attributes, before and after edits that move lines.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IncrementalRenderer,
  MathJaxRenderer,
  type ProjectSnapshot,
  type RenderedBlock,
} from '../src/render/index.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'thesis');

function loadFixture(): Map<string, string> {
  const files = new Map<string, string>();
  files.set('main.tex', readFileSync(join(FIXTURE, 'main.tex'), 'utf8'));
  for (const f of readdirSync(join(FIXTURE, 'chapters')).sort()) {
    files.set(`chapters/${f}`, readFileSync(join(FIXTURE, 'chapters', f), 'utf8'));
  }
  return files;
}

function newRenderer(): IncrementalRenderer {
  return new IncrementalRenderer({ math: new MathJaxRenderer(), now: () => performance.now() });
}

function attr(html: string, name: string): string | undefined {
  return new RegExp(`^<div[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];
}

/** Every block's wrapper attributes match its source span, and the span text is real source. */
function assertAccurate(blocks: readonly RenderedBlock[], files: Map<string, string>): void {
  for (const b of blocks) {
    expect(attr(b.html, 'data-source-file')).toBe(b.file);
    expect(attr(b.html, 'data-source-line')).toBe(String(b.startLine));
    expect(attr(b.html, 'data-source-end-line')).toBe(String(b.endLine));
    const lines = (files.get(b.file) ?? '').split('\n');
    expect(b.startLine).toBeGreaterThanOrEqual(1);
    expect(b.endLine).toBeLessThanOrEqual(lines.length);
    expect((lines[b.startLine - 1] ?? '').trim()).not.toBe('');
    // inner data-source-line values lie inside the block span
    for (const m of b.html.matchAll(/data-source-line="(\d+)"/g)) {
      const l = Number(m[1]);
      expect(l).toBeGreaterThanOrEqual(b.startLine);
      expect(l).toBeLessThanOrEqual(b.endLine);
    }
  }
}

describe('incremental renderer on the 2,500+ line fixture', () => {
  it('fixture has 2,500+ lines across 5-10 input/include files', () => {
    const files = loadFixture();
    const lines = [...files.values()].reduce((n, t) => n + t.split('\n').length, 0);
    expect(lines).toBeGreaterThanOrEqual(2500);
    expect(files.size - 1).toBeGreaterThanOrEqual(5);
    expect(files.size - 1).toBeLessThanOrEqual(10);
  });

  it('renders all files with accurate source attributes', () => {
    const files = loadFixture();
    const r = newRenderer();
    const up = r.update({ root: 'main.tex', files });
    const blocks = r.snapshot();
    expect(blocks.length).toBe(up.order.length);
    expect(new Set(blocks.map((b) => b.file)).size).toBe(9);
    assertAccurate(blocks, files);

    // a known heading maps to its exact line
    const ch3 = (files.get('chapters/ch3.tex') ?? '').split('\n');
    const secLine = ch3.findIndex((l) => l.startsWith('\\section{Section 3.4}')) + 1;
    const sec = blocks.find((b) => b.file === 'chapters/ch3.tex' && b.startLine === secLine);
    expect(sec?.html).toContain('<h2');
    expect(sec?.html).toContain(`data-source-line="${secLine}"`);
    // preamble is not rendered; unsupported tikz renders as a labelled placeholder
    expect(blocks.some((b) => b.html.includes('documentclass'))).toBe(false);
    expect(blocks.some((b) => b.html.includes('[unsupported environment: tikzpicture]'))).toBe(
      true,
    );
  });

  it('single-block edit re-renders in < 250 ms and touches only that block', () => {
    const files = loadFixture();
    const r = newRenderer();
    r.update({ root: 'main.tex', files });
    r.typesetPending(r.pendingIds()); // steady state: everything typeset

    const path = 'chapters/ch5.tex';
    const original = files.get(path) ?? '';
    const lines = original.split('\n');
    const target = lines.findIndex((l, i) => i > 200 && l.includes('We write $x_'));
    expect(target).toBeGreaterThan(0);

    const timings: number[] = [];
    for (let k = 0; k < 7; k++) {
      const edited = [...lines];
      edited[target] = `${lines[target] ?? ''} Edit ${k} with $\\alpha_{${k}} + \\norm{z}$.`;
      const next = new Map(files);
      next.set(path, edited.join('\n'));
      const snap: ProjectSnapshot = { root: 'main.tex', files: next };
      const t0 = performance.now();
      const up = r.update(snap);
      timings.push(performance.now() - t0);
      expect(up.stats.rerendered).toBe(1);
      const fresh = up.changes.filter((c) => c.status === 'new');
      expect(fresh).toHaveLength(1);
      expect(fresh[0]?.file).toBe(path);
      expect(fresh[0]?.html).toContain(`Edit ${k}`);
      expect(fresh[0]?.mathPending).toBe(false);
      expect(up.changes.filter((c) => c.status === 'moved')).toHaveLength(0);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)] ?? Infinity;
    const worst = timings[timings.length - 1] ?? Infinity;
    expect(median).toBeLessThan(250);
    expect(worst).toBeLessThan(250);
  });

  it('inserting a line moves later blocks without re-rendering them, attributes stay accurate', () => {
    const files = loadFixture();
    const r = newRenderer();
    r.update({ root: 'main.tex', files });
    const path = 'chapters/ch2.tex';
    const lines = (files.get(path) ?? '').split('\n');
    const at = lines.findIndex((l) => l.startsWith('\\section{Section 2.2}'));
    const edited = [...lines.slice(0, at), 'A brand new paragraph.', '', ...lines.slice(at)];
    const next = new Map(files);
    next.set(path, edited.join('\n'));
    const up = r.update({ root: 'main.tex', files: next });
    expect(up.stats.rerendered).toBe(1);
    const moved = up.changes.filter((c) => c.status === 'moved');
    expect(moved.length).toBeGreaterThan(10);
    expect(moved.every((m) => m.file === path && m.lineDelta === 2)).toBe(true);
    assertAccurate(r.snapshot(), next);
  });

  it('changing a preamble macro invalidates cached blocks (macro-set hash)', () => {
    const files = loadFixture();
    const r = newRenderer();
    const first = r.update({ root: 'main.tex', files });
    const next = new Map(files);
    next.set(
      'main.tex',
      (files.get('main.tex') ?? '').replace('\\def\\iid{i.i.d.}', '\\def\\iid{IID}'),
    );
    const up = r.update({ root: 'main.tex', files: next });
    expect(up.stats.rerendered).toBe(first.stats.blocks);
    expect(r.snapshot().some((b) => b.html.includes('IID'))).toBe(true);
  });
});
