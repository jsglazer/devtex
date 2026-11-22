/**
 * Minimal, tolerant BibTeX/BibLaTeX parser for citekey completion and
 * validation. The local .bib is the only citation source on iOS and the
 * fallback when Zotero/Better BibTeX is closed. Skips @comment, @string and
 * @preamble; never throws on malformed input.
 */

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i] ?? '')) i++;
  return i;
}

/** Read a balanced value starting at an opening delimiter; returns [value, end]. */
function readDelimited(s: string, i: number, open: string, close: string): [string, number] {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === open && (open !== close || j === i)) depth++;
    else if (c === close) {
      if (open === close || --depth === 0) return [s.slice(i + 1, j), j + 1];
    } else if (open === '"' && c === '{') {
      // braces inside quotes
      const [, e] = readDelimited(s, j, '{', '}');
      j = e - 1;
    }
  }
  return [s.slice(i + 1), s.length];
}

function cleanValue(v: string): string {
  return v.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseBibtex(src: string): BibEntry[] {
  const out: BibEntry[] = [];
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at === -1) break;
    const tm = /^@\s*([A-Za-z]+)\s*([{(])/.exec(src.slice(at, at + 64));
    if (!tm || tm[1] === undefined || tm[2] === undefined) {
      i = at + 1;
      continue;
    }
    const type = tm[1].toLowerCase();
    const openCh = tm[2];
    const closeCh = openCh === '{' ? '}' : ')';
    const bodyStart = at + tm[0].length;
    if (type === 'comment' || type === 'string' || type === 'preamble') {
      const [, end] = readDelimited(src, bodyStart - 1, openCh, closeCh);
      i = end;
      continue;
    }
    const keyEnd = src.indexOf(',', bodyStart);
    const closeIdx = src.indexOf(closeCh, bodyStart);
    if (keyEnd === -1 || (closeIdx !== -1 && closeIdx < keyEnd)) {
      i = bodyStart;
      continue;
    }
    const key = src.slice(bodyStart, keyEnd).trim();
    if (/[\s@{}]/.test(key)) {
      // malformed entry (no comma after the key): resume scanning after it
      i = bodyStart;
      continue;
    }
    const fields: Record<string, string> = {};
    let j = keyEnd + 1;
    for (;;) {
      j = skipWs(src, j);
      if (j >= src.length || src[j] === closeCh) {
        j++;
        break;
      }
      const fm = /^([A-Za-z][\w:-]*)\s*=\s*/.exec(src.slice(j, j + 128));
      if (!fm || fm[1] === undefined) {
        // malformed: skip to next comma or close
        const nc = src.slice(j).search(/[,}]/);
        if (nc === -1) {
          j = src.length;
          break;
        }
        j += nc + 1;
        if (src[j - 1] === closeCh) break;
        continue;
      }
      const name = fm[1].toLowerCase();
      j += fm[0].length;
      let value = '';
      // value parts joined by #
      for (;;) {
        j = skipWs(src, j);
        const c = src[j];
        if (c === '{') {
          const [v, e] = readDelimited(src, j, '{', '}');
          value += v;
          j = e;
        } else if (c === '"') {
          const [v, e] = readDelimited(src, j, '"', '"');
          value += v;
          j = e;
        } else {
          const bare = /^[^,#}\s)]+/.exec(src.slice(j));
          value += bare?.[0] ?? '';
          j += bare?.[0].length ?? 0;
        }
        j = skipWs(src, j);
        if (src[j] === '#') {
          j++;
          continue;
        }
        break;
      }
      fields[name] = cleanValue(value);
      j = skipWs(src, j);
      if (src[j] === ',') j++;
    }
    if (key !== '') out.push({ key, type, fields });
    i = j;
  }
  return out;
}

/** Short display label: "Author (Year) Title". */
export function bibLabel(e: BibEntry): string {
  const author = (e.fields['author'] ?? e.fields['editor'] ?? '').split(/\s+and\s+/)[0] ?? '';
  const surname = author.includes(',')
    ? (author.split(',')[0] ?? '')
    : (author.split(' ').pop() ?? '');
  const year = e.fields['year'] ?? (e.fields['date'] ?? '').slice(0, 4);
  const title = e.fields['title'] ?? '';
  return [surname, year ? `(${year})` : '', title].filter((s) => s !== '').join(' ');
}

/** \bibliography{a,b} / \addbibresource{x.bib} targets referenced by a text. */
export function bibResources(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(
    /\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
  )) {
    for (const part of (m[1] ?? '').split(',')) {
      const p = part.trim();
      if (p === '') continue;
      out.push(p.endsWith('.bib') ? p : `${p}.bib`);
    }
  }
  return out;
}
