/**
 * Document outline (sections, figures, tables, labels) and label collection
 * across a project. Pure: works on file snapshots.
 */
import { lineOfOffset, lineStarts, maskNonCode } from './text.js';

export type OutlineKind = 'section' | 'frame' | 'figure' | 'table' | 'label';

export interface OutlineItem {
  kind: OutlineKind;
  /** Sectioning depth (0 = part … 6 = subparagraph); frames sit one below
   * the enclosing section; 7 for floats/labels. */
  level: number;
  title: string;
  file: string;
  line: number;
}

const SECTION_DEPTH: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

function readBraced(text: string, open: number): string | null {
  if (text[open] !== '{') return null;
  let d = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return text.slice(open + 1, i);
  }
  return null;
}

/**
 * Section title for the outline (plain text): `\texorpdfstring{TeX}{text}`
 * becomes its text branch and `\boldmath`/`\unboldmath` are dropped, so a
 * heading with math reads as it does in a PDF viewer's bookmarks.
 */
export function outlineTitle(raw: string): string {
  let t = raw;
  for (;;) {
    const i = t.search(/\\texorpdfstring\s*\{/);
    if (i === -1) break;
    const open1 = t.indexOf('{', i);
    const a = readBraced(t, open1);
    if (a === null) break;
    let j = open1 + a.length + 2;
    while (/\s/.test(t[j] ?? '')) j++;
    const b = readBraced(t, j);
    if (b === null) break;
    t = t.slice(0, i) + b + t.slice(j + b.length + 2);
  }
  return t
    .replace(/\\(?:un)?boldmath(?![A-Za-z@])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function outlineOf(file: string, text: string): OutlineItem[] {
  const masked = maskNonCode(text);
  const starts = lineStarts(text);
  const items: OutlineItem[] = [];
  const re =
    /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(\[[^\]]*\])?\s*(?=\{)|\\begin\s*\{(figure\*?|table\*?)\}|\\label\s*\{([^}]*)\}|\\begin\s*\{frame\}|\\frame(?![A-Za-z@])/g;
  let sectionLevel = 1; // frames nest one level below the latest section
  for (const m of masked.matchAll(re)) {
    const line = lineOfOffset(starts, m.index);
    const isFrameEnv = /^\\begin\s*\{frame\}$/.test(m[0]);
    if (isFrameEnv || m[0] === '\\frame') {
      items.push({
        kind: 'frame',
        level: Math.min(sectionLevel + 1, 6),
        title: frameTitle(text, masked, m.index + m[0].length, !isFrameEnv) ?? 'Frame',
        file,
        line,
      });
      continue;
    }
    if (m[1] !== undefined) {
      sectionLevel = SECTION_DEPTH[m[1]] ?? 2;
      const title = readBraced(text, m.index + m[0].length) ?? '';
      items.push({
        kind: 'section',
        level: SECTION_DEPTH[m[1]] ?? 2,
        title: outlineTitle(title),
        file,
        line,
      });
    } else if (m[3] !== undefined) {
      const kind: OutlineKind = m[3].startsWith('figure') ? 'figure' : 'table';
      const endIdx = masked.indexOf(`\\end{${m[3]}}`, m.index);
      const body = masked.slice(m.index, endIdx === -1 ? undefined : endIdx);
      const cap = /\\caption\s*(\[[^\]]*\])?\s*\{/.exec(body);
      let title = kind === 'figure' ? 'Figure' : 'Table';
      if (cap) {
        const t = readBraced(text, m.index + cap.index + cap[0].length - 1);
        if (t !== null) title = t.replace(/\s+/g, ' ').trim();
      }
      items.push({ kind, level: 7, title, file, line });
    } else if (m[4] !== undefined) {
      items.push({ kind: 'label', level: 7, title: m[4].trim(), file, line });
    }
  }
  return items;
}

/**
 * Title of a Beamer frame starting at `i` (just after `\begin{frame}` or
 * `\frame`): skips overlay specs `<…>` and options `[…]`, then takes a
 * `{Title}` argument, else the first `\frametitle{…}` in the frame body.
 * For the `\frame{…}` command form the braced group is the body.
 */
function frameTitle(text: string, masked: string, i: number, commandForm = false): string | null {
  const skip = (): void => {
    while (i < masked.length && /\s/.test(masked[i] ?? '')) i++;
  };
  skip();
  for (;;) {
    const open = masked[i];
    const close = open === '<' ? '>' : open === '[' ? ']' : null;
    if (close === null) break;
    const end = masked.indexOf(close, i);
    if (end === -1) break;
    i = end + 1;
    skip();
  }
  const clean = (t: string): string => t.replace(/\s+/g, ' ').trim();
  if (!commandForm && masked[i] === '{') {
    const t = readBraced(text, i);
    if (t !== null && clean(t) !== '') return clean(t);
  }
  // \frame{…}: the braced group is the body; \begin{frame}: up to \end{frame}
  const group = commandForm ? readBraced(masked, i) : null;
  const endIdx = commandForm
    ? group === null
      ? i
      : i + group.length + 2
    : masked.indexOf('\\end{frame}', i);
  const body = masked.slice(i, endIdx === -1 ? undefined : endIdx);
  const ft = /\\frametitle\s*(<[^>]*>)?\s*(\[[^\]]*\])?\s*\{/.exec(body);
  if (ft) {
    const t = readBraced(text, i + ft.index + ft[0].length - 1);
    if (t !== null) return clean(t);
  }
  if (/\\titlepage(?![A-Za-z@])/.test(body)) return 'Title page';
  return null;
}

export function projectOutline(
  files: readonly string[],
  get: (f: string) => string | undefined,
): OutlineItem[] {
  return files.flatMap((f) => outlineOf(f, get(f) ?? ''));
}

export function labelsOf(items: readonly OutlineItem[]): string[] {
  return items.filter((i) => i.kind === 'label').map((i) => i.title);
}
