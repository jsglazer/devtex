/**
 * Magic comments at the top of a .tex file:
 *   % !TEX root = <path>
 *   % !TEX program = <engine>
 *   % !DevTex git = <repo folder>/
 *   % !DevTex pushed = YYYYMMDD-HHMMSS
 *   % !DevTex submitstamp = <value>
 * Only the leading comment/blank block of the file is scanned, as TeXShop/
 * TeXstudio do.
 */

export interface MagicComments {
  root?: string;
  program?: string;
  git?: string;
  pushed?: string;
  submitstamp?: string;
}

const MAGIC_RE = /^\s*%\s*!\s*(TEX|DevTex)\s+([A-Za-z]+)\s*=\s*(.*?)\s*$/i;

/** Number of leading lines that are blank or comments (the magic-comment header). */
function headerLineCount(lines: readonly string[]): number {
  let k = 0;
  while (k < lines.length) {
    const l = lines[k] ?? '';
    if (l.trim() === '' || l.trimStart().startsWith('%')) k++;
    else break;
  }
  return k;
}

export function parseMagicComments(text: string): MagicComments {
  const lines = text.split('\n');
  const out: MagicComments = {};
  const n = headerLineCount(lines);
  for (let i = 0; i < n; i++) {
    const m = MAGIC_RE.exec(lines[i] ?? '');
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) continue;
    const ns = m[1].toLowerCase();
    const key = m[2].toLowerCase();
    const value = m[3];
    if (value === '') continue;
    if (ns === 'tex' && key === 'root') out.root = value;
    else if (ns === 'tex' && key === 'program') out.program = value.toLowerCase();
    else if (ns === 'devtex' && key === 'git') out.git = value;
    else if (ns === 'devtex' && key === 'pushed') out.pushed = value;
    else if (ns === 'devtex' && key === 'submitstamp') out.submitstamp = value;
  }
  return out;
}

/**
 * Set (or insert) `% !DevTex <key> = <value>` in the header. Existing line is
 * replaced in place; otherwise the line is inserted after the last existing
 * magic comment, or at the top of the file.
 */
export function setDevTexMagic(
  text: string,
  key: 'git' | 'pushed' | 'submitstamp',
  value: string,
): string {
  const lines = text.split('\n');
  const n = headerLineCount(lines);
  const newLine = `% !DevTex ${key} = ${value}`;
  let lastMagic = -1;
  for (let i = 0; i < n; i++) {
    const m = MAGIC_RE.exec(lines[i] ?? '');
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    lastMagic = i;
    if (m[1].toLowerCase() === 'devtex' && m[2].toLowerCase() === key) {
      lines[i] = newLine;
      return lines.join('\n');
    }
  }
  lines.splice(lastMagic + 1, 0, newLine);
  return lines.join('\n');
}

export type Engine = 'pdflatex' | 'xelatex' | 'lualatex';

/** Engine from `% !TEX program`, defaulting to pdflatex for unknown values. */
export function engineOf(magic: MagicComments): Engine {
  const p = magic.program ?? '';
  if (p === 'xelatex' || p === 'lualatex' || p === 'pdflatex') return p;
  return 'pdflatex';
}
