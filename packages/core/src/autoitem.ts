/**
 * Auto-\item: Enter inside itemize/enumerate/description starts a new \item;
 * Enter on an empty \item ends the list (the empty item is removed and the
 * cursor moves to a new line after \end{…}), like Markdown lists in Obsidian.
 * Pure: returns an edit for the editor to apply, or null to fall through to
 * the default Enter.
 */
import { isEscaped, maskNonCode } from './text.js';

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  /** Cursor offset after applying the edit (in the new document). */
  cursor: number;
}

const LIST_ENVS = ['itemize', 'enumerate', 'description'];
const EMPTY_ITEM_RE = /^(\s*)\\item(\[\s*\])?\s*$/;

interface OpenList {
  name: string;
  beginFrom: number;
  beginLineIndent: string;
  /** Offset of the matching \end, or null when unclosed. */
  endFrom: number | null;
  endTo: number | null;
}

/** The innermost open environment at pos, when it is a list (pos after its \begin tag). */
function enclosingList(masked: string, text: string, pos: number): OpenList | null {
  const stack: { name: string; from: number; to: number }[] = [];
  let found: { name: string; from: number; to: number } | null = null;
  const re = /\\(begin|end)\s*\{([^}\n]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const name = m[2] ?? '';
    if (m.index >= pos && found === null) {
      // first tag at/after the cursor: the innermost open list is on the stack
      const s = stack[stack.length - 1];
      if (s && LIST_ENVS.includes(s.name) && s.to <= pos) found = s;
      if (found === null) return null;
    }
    if (m[1] === 'begin') stack.push({ name, from: m.index, to: m.index + m[0].length });
    else {
      const top = stack.pop();
      if (found !== null && top === found) {
        return {
          name: found.name,
          beginFrom: found.from,
          beginLineIndent: indentAt(text, found.from),
          endFrom: m.index,
          endTo: m.index + m[0].length,
        };
      }
    }
  }
  if (found === null) {
    const s = stack[stack.length - 1];
    if (s && LIST_ENVS.includes(s.name) && s.to <= pos) found = s;
  }
  if (found === null) return null;
  return {
    name: found.name,
    beginFrom: found.from,
    beginLineIndent: indentAt(text, found.from),
    endFrom: null,
    endTo: null,
  };
}

function lineStartOf(text: string, pos: number): number {
  const i = text.lastIndexOf('\n', pos - 1);
  return i === -1 ? 0 : i + 1;
}

function lineEndOf(text: string, pos: number): number {
  const i = text.indexOf('\n', pos);
  return i === -1 ? text.length : i;
}

function indentAt(text: string, pos: number): string {
  const start = lineStartOf(text, pos);
  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
}

/** Indentation of the nearest \item line at or above pos within the list. */
function itemIndent(text: string, masked: string, list: OpenList, pos: number): string {
  const region = masked.slice(list.beginFrom, pos);
  const idx = region.lastIndexOf('\\item');
  if (idx !== -1 && !isEscaped(region, idx)) return indentAt(text, list.beginFrom + idx);
  return `${list.beginLineIndent}  `;
}

export function autoItemOnEnter(text: string, pos: number): TextEdit | null {
  const masked = maskNonCode(text);
  // inside a comment? leave Enter alone
  const ls = lineStartOf(text, pos);
  if (masked.slice(ls, pos) !== text.slice(ls, pos)) return null;

  const list = enclosingList(masked, text, pos);
  if (list === null) return null;

  const le = lineEndOf(text, pos);
  const line = text.slice(ls, le);

  if (EMPTY_ITEM_RE.test(line)) {
    if (list.endFrom !== null && list.endTo !== null) {
      const removeTo = le < text.length ? le + 1 : le;
      if (text.slice(le, list.endFrom).trim() === '') {
        // last item: delete it and open a new line after \end{…}
        const endLineEnd = lineEndOf(text, list.endTo);
        const insert = `${text.slice(removeTo, endLineEnd)}\n`;
        return { from: ls, to: endLineEnd, insert, cursor: ls + insert.length };
      }
      // empty item in the middle of the list: drop the \item, keep the line
      return { from: ls, to: le, insert: '', cursor: ls };
    }
    // unclosed list: the empty item becomes its \end
    const insert = `${list.beginLineIndent}\\end{${list.name}}\n`;
    return { from: ls, to: le, insert, cursor: ls + insert.length };
  }

  const indent = /\\begin\s*\{(itemize|enumerate|description)\}\s*(\[[^\]]*\])?\s*$/.test(
    masked.slice(ls, pos),
  )
    ? `${list.beginLineIndent}  `
    : itemIndent(text, masked, list, pos);
  const item = list.name === 'description' ? '\\item[] ' : '\\item ';
  const insert = `\n${indent}${item}`;
  const cursor = pos + insert.length - (list.name === 'description' ? 2 : 0);
  return { from: pos, to: pos, insert, cursor };
}
