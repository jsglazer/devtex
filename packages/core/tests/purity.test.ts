/**
 * Reviewer criterion: pure parser, preview and editor-logic modules contain
 * zero imports from @tauri-apps/*, obsidian, or browser window/document.
 * Scans every non-test source file in packages/core/src (and the shared
 * cm-latex logic files that must stay DOM-free).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory()
      ? walk(p)
      : p.endsWith('.ts') && !p.endsWith('.test.ts')
        ? [p]
        : [];
  });
}

const SRC = join(import.meta.dirname, '..', 'src');
const FORBIDDEN_IMPORT =
  /from\s+['"](@tauri-apps\/[^'"]*|obsidian|node:[^'"]*|fs|path|child_process|http|https|net)['"]/;
const FORBIDDEN_GLOBAL = [
  /(?<![.\w{'"$])(window|document|navigator|localStorage|sessionStorage|globalThis)\s*[.[]/,
  /(?<![.\w])(fetch|setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest|WebSocket)\s*\(/,
  /\bDate\.now\b|\bnew Date\(|\bMath\.random\b|\bperformance\.now\b|\bprocess\.\w/,
];

describe('packages/core purity', () => {
  const files = walk(SRC);
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(15);
  });
  for (const f of files) {
    it(`${f.slice(SRC.length + 1)} has no platform imports or ambient I/O/time`, () => {
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(FORBIDDEN_IMPORT);
      for (const re of FORBIDDEN_GLOBAL) expect(code).not.toMatch(re);
    });
  }
});
