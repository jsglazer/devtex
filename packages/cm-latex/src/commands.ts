/**
 * Editor commands backed by @devtex/core logic: auto-\item on Enter,
 * wrapping formatting, and palette insertion.
 */
import {
  EditorSelection,
  type EditorState,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { autoItemOnEnter, splitCursor } from '@devtex/core';

/** Minimal view surface so commands are testable without a DOM. */
export interface CommandTarget {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}

/** Enter inside itemize/enumerate/description; returns false to fall through. */
export function autoItemEnter(view: CommandTarget): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return false;
  const edit = autoItemOnEnter(state.doc.toString(), sel.head);
  if (edit === null) return false;
  view.dispatch(
    state.update({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.cursor },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  );
  return true;
}

/** Wrap each selection in \cmd{…}; with an empty selection, insert \cmd{} and put the cursor inside. */
export function wrapCommand(cmd: string): (view: CommandTarget) => boolean {
  return (view) => {
    const { state } = view;
    const spec: TransactionSpec = state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const insert = `\\${cmd}{${text}}`;
      const anchor = range.from + cmd.length + 2;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: range.empty
          ? EditorSelection.cursor(anchor)
          : EditorSelection.range(anchor, anchor + text.length),
      };
    });
    view.dispatch(state.update(spec, { userEvent: 'input', scrollIntoView: true }));
    return true;
  };
}

/** Insert a template containing an optional `|` cursor marker, replacing the selection. */
export function insertTemplate(view: CommandTarget, template: string): boolean {
  const { text, cursor } = splitCursor(template);
  const { state } = view;
  const indent = (() => {
    const line = state.doc.lineAt(state.selection.main.from);
    return /^[ \t]*/.exec(line.text)?.[0] ?? '';
  })();
  const body = text.replace(/\n/g, `\n${indent}`);
  const cursorShift = text.slice(0, cursor).split('\n').length - 1;
  const at = state.selection.main.from;
  view.dispatch(
    state.update({
      changes: { from: at, to: state.selection.main.to, insert: body },
      selection: { anchor: at + cursor + cursorShift * indent.length },
      userEvent: 'input',
      scrollIntoView: true,
    }),
  );
  return true;
}
