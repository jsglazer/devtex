/**
 * Collect user macros from the preamble and every \input/\include file:
 * \newcommand, \renewcommand, \providecommand (starred too),
 * \DeclareMathOperator(*), and argument-free \def. The resulting set is
 * passed to MathJax (as TeX macros) and to the text renderer (for expansion).
 */
import { hashString } from './hash.js';
import { maskNonCode } from './text.js';

export interface MacroDef {
  name: string;
  /** Number of arguments (0-9). */
  arity: number;
  /** Default for the first argument when it is optional, else undefined. */
  optionalDefault?: string;
  body: string;
  kind: 'newcommand' | 'operator' | 'def';
}

export type MacroSet = ReadonlyMap<string, MacroDef>;

/** Read a balanced {...} group starting at `i` (text[i] === '{'). */
function readGroup(text: string, i: number): { content: string; end: number } | null {
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { content: text.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

function readBracket(text: string, i: number): { content: string; end: number } | null {
  if (text[i] !== '[') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ']' && depth === 0) return { content: text.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i] ?? '')) i++;
  return i;
}

/** Parse the macro name argument: `{\foo}` or `\foo`. */
function readName(text: string, i: number): { name: string; end: number } | null {
  i = skipWs(text, i);
  if (text[i] === '{') {
    const g = readGroup(text, i);
    if (!g) return null;
    const m = /^\s*\\([A-Za-z@]+|.)\s*$/.exec(g.content);
    if (!m || m[1] === undefined) return null;
    return { name: m[1], end: g.end };
  }
  const m = /^\\([A-Za-z@]+|.)/.exec(text.slice(i));
  if (!m || m[1] === undefined) return null;
  return { name: m[1], end: i + m[0].length };
}

/** Collect macro definitions from one source text, in order. */
export function collectMacrosFromText(text: string): MacroDef[] {
  const masked = maskNonCode(text);
  const out: MacroDef[] = [];
  const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def)(\*?)/g;
  for (const m of masked.matchAll(re)) {
    const cmd = m[1];
    let i = m.index + m[0].length;
    if (cmd === 'def') {
      const nm = /^\s*\\([A-Za-z@]+)\s*\{/.exec(masked.slice(i));
      if (!nm || nm[1] === undefined) continue; // \def with parameters is not argument-free
      const g = readGroup(masked, i + nm[0].length - 1);
      if (!g) continue;
      out.push({
        name: nm[1],
        arity: 0,
        body: text.slice(i + nm[0].length, g.end - 1),
        kind: 'def',
      });
      continue;
    }
    const name = readName(masked, i);
    if (!name) continue;
    i = name.end;
    if (cmd === 'DeclareMathOperator') {
      i = skipWs(masked, i);
      const g = readGroup(masked, i);
      if (!g) continue;
      const opBody = text.slice(i + 1, g.end - 1);
      const star = m[2] === '*';
      out.push({
        name: name.name,
        arity: 0,
        body: star ? `\\operatorname*{${opBody}}` : `\\operatorname{${opBody}}`,
        kind: 'operator',
      });
      continue;
    }
    let arity = 0;
    let optionalDefault: string | undefined;
    i = skipWs(masked, i);
    const a = readBracket(masked, i);
    if (a) {
      const k = Number.parseInt(a.content.trim(), 10);
      if (Number.isFinite(k) && k >= 0 && k <= 9) arity = k;
      i = skipWs(masked, a.end);
      const d = readBracket(masked, i);
      if (d) {
        optionalDefault = text.slice(i + 1, d.end - 1);
        i = skipWs(masked, d.end);
      }
    }
    const body = readGroup(masked, i);
    if (!body) continue;
    const def: MacroDef = {
      name: name.name,
      arity,
      body: text.slice(i + 1, body.end - 1),
      kind: 'newcommand',
    };
    if (optionalDefault !== undefined) def.optionalDefault = optionalDefault;
    out.push(def);
  }
  return out;
}

/**
 * Merge definitions from several texts (preamble first, then include files in
 * order). Later definitions win, matching \renewcommand semantics.
 */
export function collectMacros(texts: readonly string[]): Map<string, MacroDef> {
  const map = new Map<string, MacroDef>();
  for (const t of texts) for (const d of collectMacrosFromText(t)) map.set(d.name, d);
  return map;
}

/** Stable hash of a macro set, used in cache keys. */
export function macroSetHash(set: MacroSet): string {
  const parts = [...set.values()]
    .map((d) => `${d.name}|${d.arity}|${d.optionalDefault ?? ''}|${d.body}`)
    .sort();
  return hashString(parts.join('\u0001'));
}

/** MathJax `tex.macros` configuration for a macro set. */
export function toMathJaxMacros(
  set: MacroSet,
): Record<string, string | [string, number] | [string, number, string]> {
  const out: Record<string, string | [string, number] | [string, number, string]> = {};
  for (const d of set.values()) {
    if (d.arity === 0) out[d.name] = d.body;
    else if (d.optionalDefault !== undefined) out[d.name] = [d.body, d.arity, d.optionalDefault];
    else out[d.name] = [d.body, d.arity];
  }
  return out;
}

/** unified-latex argument signatures ("o m m") so the parser attaches args. */
export function toParserSignatures(set: MacroSet): Record<string, { signature: string }> {
  const out: Record<string, { signature: string }> = {};
  for (const d of set.values()) {
    if (d.arity === 0) continue;
    const sig: string[] = [];
    for (let k = 0; k < d.arity; k++)
      sig.push(k === 0 && d.optionalDefault !== undefined ? 'o' : 'm');
    out[d.name] = { signature: sig.join(' ') };
  }
  return out;
}

/** Substitute #1..#9 in a macro body. */
export function expandMacroBody(def: MacroDef, args: readonly string[]): string {
  return def.body.replace(/#([1-9])/g, (_m, d: string) => args[Number(d) - 1] ?? '');
}

/** Title-page fields (raw TeX) from \title, \subtitle, \author, \institute and \date. */
export interface TitleMeta {
  title?: string;
  subtitle?: string;
  author?: string;
  institute?: string;
  date?: string;
}

export const TITLE_FIELDS = ['title', 'subtitle', 'author', 'institute', 'date'] as const;

/**
 * Collect title-page fields across texts (preamble first, later wins). The
 * optional short form (`\title[Short]{Long}`) is skipped; the long form is kept.
 */
export function collectTitleMeta(texts: readonly string[]): TitleMeta {
  const meta: TitleMeta = {};
  for (const text of texts) {
    const masked = maskNonCode(text);
    for (const m of masked.matchAll(/\\(title|subtitle|author|institute|date)(?![A-Za-z@])/g)) {
      let i = skipWs(masked, m.index + m[0].length);
      const opt = readBracket(masked, i);
      if (opt) i = skipWs(masked, opt.end);
      const g = readGroup(masked, i);
      if (!g) continue;
      meta[m[1] as keyof TitleMeta] = text.slice(i + 1, g.end - 1);
    }
  }
  return meta;
}

/** Stable hash of title metadata, used in cache keys. */
export function titleMetaHash(meta: TitleMeta): string {
  return hashString(TITLE_FIELDS.map((f) => meta[f] ?? '\u0000').join('\u0001'));
}
