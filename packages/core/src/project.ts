/**
 * Multi-file project model: the \input/\include graph and root resolution.
 * All inputs are in-memory snapshots (project-relative POSIX path -> text);
 * the shell reads the files and passes them in.
 */
import { parseMagicComments } from './magic.js';
import { dirname, joinPath, lineOfOffset, lineStarts, maskNonCode } from './text.js';

export type FileMap = ReadonlyMap<string, string>;

export interface IncludeRef {
  /** Resolved project-relative path (with .tex added when missing). */
  target: string;
  /** Raw argument as written. */
  raw: string;
  command: 'input' | 'include' | 'subfile';
  /** 1-based line of the command in the including file. */
  line: number;
}

const INCLUDE_RE = /\\(input|include|subfile)\s*\{([^}]+)\}/g;

/** Resolve an \input argument the way TeX does relative to the root's folder. */
export function resolveIncludePath(rootDir: string, raw: string): string {
  const arg = raw.trim();
  const withExt = /\.[A-Za-z0-9]+$/.test(arg) ? arg : `${arg}.tex`;
  return joinPath(rootDir, withExt);
}

/**
 * Include commands in `text` (comments/verbatim ignored). Paths resolve
 * relative to `rootDir` (TeX resolves \input against the working directory,
 * which is the root document's folder).
 */
export function findIncludes(text: string, rootDir: string): IncludeRef[] {
  const masked = maskNonCode(text);
  const starts = lineStarts(text);
  const out: IncludeRef[] = [];
  for (const m of masked.matchAll(INCLUDE_RE)) {
    const cmd = m[1];
    const raw = m[2];
    if (cmd === undefined || raw === undefined) continue;
    out.push({
      command: cmd as IncludeRef['command'],
      raw,
      target: resolveIncludePath(rootDir, raw),
      line: lineOfOffset(starts, m.index),
    });
  }
  return out;
}

/** All files reachable from `root` (root first, depth-first, cycle-safe). */
export function includeClosure(root: string, files: FileMap): string[] {
  const rootDir = dirname(root);
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (f: string): void => {
    if (seen.has(f)) return;
    seen.add(f);
    const text = files.get(f);
    if (text === undefined) return;
    order.push(f);
    for (const inc of findIncludes(text, rootDir)) visit(inc.target);
  };
  visit(root);
  return order;
}

/** Files the root references that are missing from the snapshot. */
export function missingIncludes(root: string, files: FileMap): string[] {
  const rootDir = dirname(root);
  const missing = new Set<string>();
  for (const f of includeClosure(root, files)) {
    for (const inc of findIncludes(files.get(f) ?? '', rootDir)) {
      if (!files.has(inc.target)) missing.add(inc.target);
    }
  }
  return [...missing].sort();
}

function hasDocumentEnv(text: string): boolean {
  return /\\begin\s*\{document\}/.test(maskNonCode(text));
}

export type RootSource = 'magic' | 'self' | 'graph' | 'fallback';

export interface RootResolution {
  root: string;
  source: RootSource;
}

/**
 * Root document for `openFile`:
 *  1. `% !TEX root = <path>` in the open file (relative to its folder);
 *  2. the open file itself if it contains \begin{document};
 *  3. otherwise the .tex in the project whose include graph contains the open
 *     file (preferring a file that has \begin{document}, then shortest path,
 *     then alphabetical — fully deterministic);
 *  4. otherwise the open file.
 */
export function resolveRoot(openFile: string, files: FileMap): RootResolution {
  const text = files.get(openFile) ?? '';
  const magic = parseMagicComments(text);
  if (magic.root !== undefined) {
    return { root: joinPath(dirname(openFile), magic.root), source: 'magic' };
  }
  if (hasDocumentEnv(text)) return { root: openFile, source: 'self' };
  const candidates: string[] = [];
  for (const [path, body] of files) {
    if (path === openFile || !path.endsWith('.tex')) continue;
    if (!hasDocumentEnv(body)) continue;
    if (includeClosure(path, files).includes(openFile)) candidates.push(path);
  }
  candidates.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const best = candidates[0];
  if (best !== undefined) return { root: best, source: 'graph' };
  return { root: openFile, source: 'fallback' };
}

/** Preamble of the root (text before \begin{document}), or '' when absent. */
export function preambleOf(rootText: string): string {
  const m = /\\begin\s*\{document\}/.exec(maskNonCode(rootText));
  return m ? rootText.slice(0, m.index) : '';
}
