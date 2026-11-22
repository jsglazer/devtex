/**
 * Document outline (sections, figures, tables, labels) and label collection
 * across a project. Pure: works on file snapshots.
 */
import { lineOfOffset, lineStarts, maskNonCode } from './text.js';

export type OutlineKind = 'section' | 'figure' | 'table' | 'label';

export interface OutlineItem {
  kind: OutlineKind;
  /** Sectioning depth (0 = part … 6 = subparagraph); 7 for floats/labels. */
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

export function outlineOf(file: string, text: string): OutlineItem[] {
  const masked = maskNonCode(text);
  const starts = lineStarts(text);
  const items: OutlineItem[] = [];
  const re =
    /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(\[[^\]]*\])?\s*(?=\{)|\\begin\s*\{(figure\*?|table\*?)\}|\\label\s*\{([^}]*)\}/g;
  for (const m of masked.matchAll(re)) {
    const line = lineOfOffset(starts, m.index);
    if (m[1] !== undefined) {
      const title = readBraced(text, m.index + m[0].length) ?? '';
      items.push({
        kind: 'section',
        level: SECTION_DEPTH[m[1]] ?? 2,
        title: title.replace(/\s+/g, ' ').trim(),
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

export function projectOutline(
  files: readonly string[],
  get: (f: string) => string | undefined,
): OutlineItem[] {
  return files.flatMap((f) => outlineOf(f, get(f) ?? ''));
}

export function labelsOf(items: readonly OutlineItem[]): string[] {
  return items.filter((i) => i.kind === 'label').map((i) => i.title);
}
