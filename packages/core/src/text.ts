/**
 * Pure text utilities shared by every core module: line/offset conversion,
 * comment and verbatim masking, and POSIX path helpers. No I/O, no DOM.
 */

/** Offsets (0-based) of the first character of each line. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** 1-based line number containing `offset`. */
export function lineOfOffset(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const s = starts[mid] ?? 0;
    if (s <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** True when the character at `index` is escaped by an odd run of backslashes. */
export function isEscaped(text: string, index: number): boolean {
  let n = 0;
  for (let i = index - 1; i >= 0 && text.charCodeAt(i) === 92; i--) n++;
  return n % 2 === 1;
}

const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment', 'Verbatim'];

function blank(s: string): string {
  return s.replace(/[^\n]/g, ' ');
}

/**
 * Replace comments, `\verb` arguments and verbatim-environment bodies with
 * spaces, preserving every offset and newline. Structural scanners (brackets,
 * environments, includes, labels) run on the masked text so that `%` comments
 * and verbatim code never produce false matches.
 */
export function maskNonCode(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '%' && !isEscaped(text, i)) {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '\\' && !isEscaped(text, i)) {
      const verb = /^\\verb\*?([^a-zA-Z\s*])/.exec(text.slice(i, i + 8));
      if (verb && verb[1] !== undefined) {
        const delim = verb[1];
        const bodyStart = i + verb[0].length;
        const close = text.indexOf(delim, bodyStart);
        const nl = text.indexOf('\n', bodyStart);
        if (close !== -1 && (nl === -1 || close < nl)) {
          out += text.slice(i, bodyStart) + blank(text.slice(bodyStart, close)) + delim;
          i = close + 1;
          continue;
        }
      }
      const begin = /^\\begin\{([^}]+)\}/.exec(text.slice(i, i + 40));
      if (begin && begin[1] !== undefined && VERBATIM_ENVS.includes(begin[1])) {
        const endTag = `\\end{${begin[1]}}`;
        const bodyStart = i + begin[0].length;
        const close = text.indexOf(endTag, bodyStart);
        const stop = close === -1 ? n : close;
        out += text.slice(i, bodyStart) + blank(text.slice(bodyStart, stop));
        i = stop;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Normalize a POSIX path: collapse `.`/`..`/duplicate slashes. */
export function normalizePath(p: string): string {
  const abs = p.startsWith('/');
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!abs) parts.push('..');
      continue;
    }
    parts.push(seg);
  }
  const joined = parts.join('/');
  return abs ? `/${joined}` : joined === '' ? '.' : joined;
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export function joinPath(dir: string, rel: string): string {
  if (rel.startsWith('/')) return normalizePath(rel);
  if (dir === '.' || dir === '') return normalizePath(rel);
  return normalizePath(`${dir}/${rel}`);
}

/** Path of `p` relative to directory `from` (both normalized, same root kind). */
export function relativePath(from: string, p: string): string {
  const a = normalizePath(from)
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  const b = normalizePath(p)
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const up = a.slice(k).map(() => '..');
  const rest = b.slice(k);
  const r = [...up, ...rest].join('/');
  return r === '' ? '.' : r;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
