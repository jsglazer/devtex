/**
 * Linked editing of environment names: typing in the name of a \begin{…} or
 * \end{…} tag rewrites the partner tag's name in the same transaction, so
 * one undo reverts both. Pairing comes from @devtex/core's analyzeStructure.
 */
import {
  EditorState,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { analyzeStructure, type Range } from '@devtex/core';
import { structureField } from './structure.js';

/** Name span inside a `\begin{name}` / `\end{name}` tag range. */
function nameRange(state: EditorState, tag: Range): Range {
  const text = state.sliceDoc(tag.from, tag.to);
  return { from: tag.from + text.indexOf('{') + 1, to: tag.to - 1 };
}

/** The partner edit for `tr`, or null when it does not edit one env name. */
export function envRenameSpec(tr: Transaction): TransactionSpec | null {
  if (!tr.docChanged || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return null;
  const changed: Range[] = [];
  tr.changes.iterChangedRanges((fromA, toA) => changed.push({ from: fromA, to: toA }));
  if (changed.length !== 1) return null;
  const [c] = changed;
  if (c === undefined) return null;
  const start = tr.startState;
  const a = start.field(structureField, false) ?? analyzeStructure(start.doc.toString());
  for (const p of a.pairs) {
    const begin = nameRange(start, p.begin);
    const end = nameRange(start, p.end);
    const inside = (r: Range): boolean => c.from >= r.from && c.to <= r.to;
    const edited = inside(begin) ? begin : inside(end) ? end : null;
    if (edited === null) continue;
    const partner = edited === begin ? end : begin;
    const from = tr.changes.mapPos(edited.from, -1);
    const to = tr.changes.mapPos(edited.to, 1);
    const name = tr.newDoc.sliceString(from, to);
    if (/[{}\\\n]/.test(name)) return null;
    const pFrom = tr.changes.mapPos(partner.from, 1);
    const pTo = tr.changes.mapPos(partner.to, -1);
    if (tr.newDoc.sliceString(pFrom, pTo) === name) return null;
    return { changes: { from: pFrom, to: pTo, insert: name }, sequential: true };
  }
  return null;
}

export function envRename(): Extension {
  return EditorState.transactionFilter.of((tr) => {
    const spec = envRenameSpec(tr);
    return spec === null ? tr : [tr, spec];
  });
}
