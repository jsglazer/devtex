import { describe, expect, it } from 'vitest';
import { autoItemOnEnter, type TextEdit } from './autoitem.js';

/** Apply an edit; `|` in the input marks the cursor, and is returned in the output. */
function enter(withCursor: string): string | null {
  const pos = withCursor.indexOf('|');
  const text = withCursor.replace('|', '');
  const e: TextEdit | null = autoItemOnEnter(text, pos);
  if (e === null) return null;
  const out = text.slice(0, e.from) + e.insert + text.slice(e.to);
  return `${out.slice(0, e.cursor)}|${out.slice(e.cursor)}`;
}

describe('autoItemOnEnter', () => {
  it('starts a new \\item with the same indentation', () => {
    expect(enter('\\begin{itemize}\n  \\item one|\n\\end{itemize}')).toBe(
      '\\begin{itemize}\n  \\item one\n  \\item |\n\\end{itemize}',
    );
  });

  it('works in enumerate and splits a line in the middle', () => {
    expect(enter('\\begin{enumerate}\n\\item ab|cd\n\\end{enumerate}')).toBe(
      '\\begin{enumerate}\n\\item ab\n\\item |cd\n\\end{enumerate}',
    );
  });

  it('description items get an empty label with the cursor inside it', () => {
    expect(enter('\\begin{description}\n  \\item[A] x|\n\\end{description}')).toBe(
      '\\begin{description}\n  \\item[A] x\n  \\item[|] \n\\end{description}',
    );
  });

  it('Enter right after \\begin{itemize} starts the first item, indented', () => {
    expect(enter('\\begin{itemize}|\n\\end{itemize}')).toBe(
      '\\begin{itemize}\n  \\item |\n\\end{itemize}',
    );
  });

  it('Enter on an empty last \\item ends the list', () => {
    expect(enter('\\begin{itemize}\n  \\item one\n  \\item |\n\\end{itemize}\nafter')).toBe(
      '\\begin{itemize}\n  \\item one\n\\end{itemize}\n|\nafter',
    );
  });

  it('Enter on an empty \\item of an unclosed list closes it', () => {
    expect(enter('\\begin{itemize}\n  \\item one\n  \\item |')).toBe(
      '\\begin{itemize}\n  \\item one\n\\end{itemize}\n|',
    );
  });

  it('Enter on an empty item in the middle drops the \\item', () => {
    expect(enter('\\begin{itemize}\n  \\item |\n  \\item two\n\\end{itemize}')).toBe(
      '\\begin{itemize}\n|\n  \\item two\n\\end{itemize}',
    );
  });

  it('nested lists use the inner list', () => {
    const t =
      '\\begin{itemize}\n  \\item a\n  \\begin{enumerate}\n    \\item b|\n  \\end{enumerate}\n\\end{itemize}';
    expect(enter(t)).toBe(
      '\\begin{itemize}\n  \\item a\n  \\begin{enumerate}\n    \\item b\n    \\item |\n  \\end{enumerate}\n\\end{itemize}',
    );
  });

  it('falls through outside lists, inside nested non-list envs, and in comments', () => {
    expect(enter('plain text|')).toBeNull();
    expect(enter('\\begin{itemize}\\end{itemize} after|')).toBeNull();
    expect(
      enter('\\begin{itemize}\n\\item \\begin{equation}x|\\end{equation}\n\\end{itemize}'),
    ).toBeNull();
    expect(enter('\\begin{itemize}\n\\item x % comment|\n\\end{itemize}')).toBeNull();
  });
});
