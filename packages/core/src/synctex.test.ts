import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeSyncTex, parseSyncTex, syncToPdf, syncToSource } from './synctex.js';

// Real pdflatex output for tests/fixtures/synctex/{main,sub}.tex (paths made relative).
const GZ = new Uint8Array(
  readFileSync(join(import.meta.dirname, '..', 'tests', 'fixtures', 'synctex', 'main.synctex.gz')),
);
const BASE = '/proj';

describe('SyncTeX parser', () => {
  const data = parseSyncTex(decodeSyncTex(GZ));

  it('decodes gzip and reads inputs, pages and offsets', () => {
    expect(data.numberPages).toBe(1);
    expect([...data.files.values()].map((f) => f.path)).toContain('./sub.tex');
    expect(data.blockNumberLine.has('./main.tex')).toBe(true);
    expect(data.blockNumberLine.has('./sub.tex')).toBe(true);
  });

  it('forward search: lines map to increasing positions on page 1', () => {
    const a = syncToPdf(data, '/proj/main.tex', 4, BASE);
    const g = syncToPdf(data, '/proj/main.tex', 10, BASE);
    const b = syncToPdf(data, '/proj/sub.tex', 1, BASE);
    expect(a?.page).toBe(1);
    expect(b?.page).toBe(1);
    expect(g?.page).toBe(1);
    // Alpha (main:4) is above Beta (sub:1), which is above Gamma (main:10)
    expect(a && b && a.y < b.y).toBe(true);
    expect(b && g && b.y < g.y).toBe(true);
    expect(a?.rect).toBeDefined();
  });

  it('forward search on an unknown file returns undefined', () => {
    expect(syncToPdf(data, '/proj/nope.tex', 1, BASE)).toBeUndefined();
  });

  it('inverse search round-trips forward results to the same source', () => {
    for (const [file, line] of [
      ['/proj/main.tex', 4],
      ['/proj/sub.tex', 3],
      ['/proj/main.tex', 10],
    ] as const) {
      const pos = syncToPdf(data, file, line, BASE);
      expect(pos).toBeDefined();
      if (!pos?.rect) continue;
      const cx = (pos.rect.left + pos.rect.right) / 2;
      const cy = (pos.rect.top + pos.rect.bottom) / 2;
      const src = syncToSource(data, pos.page, cx, cy, BASE);
      expect(src?.file).toBe(file);
      expect(Math.abs((src?.line ?? 0) - line)).toBeLessThanOrEqual(1);
    }
  });

  it('accepts uncompressed .synctex too', () => {
    const plain = decodeSyncTex(strToU8(decodeSyncTex(GZ), true));
    expect(parseSyncTex(plain).numberPages).toBe(1);
    expect(decodeSyncTex(gzipSync(strToU8('SyncTeX Version:1\n')))).toBe('SyncTeX Version:1\n');
  });

  it('vertical-list nodes (e.g. \\end{frame} glue) do not take the page-high vbox height', () => {
    // a page-high vbox holding glue from line 9 and a text line (hbox) from line 3
    const sp = (pt: number): number => Math.round(pt * 65781.76);
    const body = [
      'SyncTeX Version:1',
      'Input:1:./a.tex',
      'X Offset:0',
      'Y Offset:0',
      'Content:',
      '{1',
      `[1,1:${sp(20)},${sp(300)}:${sp(300)},${sp(290)},0`,
      `(1,3:${sp(30)},${sp(50)}:${sp(200)},${sp(10)},${sp(2)}`,
      `x1,3:${sp(30)},${sp(50)}`,
      ')',
      `g1,9:${sp(20)},${sp(120)}`,
      ']',
      '}1',
    ].join('\n');
    const d = parseSyncTex(body);
    const loc = syncToPdf(d, '/proj/a.tex', 9, BASE);
    expect(loc?.rect && loc.rect.bottom - loc.rect.top).toBe(0);
    expect(loc?.y).toBeCloseTo(120, 0);
    const text = syncToPdf(d, '/proj/a.tex', 3, BASE);
    expect(text?.rect && text.rect.bottom - text.rect.top).toBeCloseTo(10, 0);
  });
});
