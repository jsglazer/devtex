/**
 * Environment-pair highlighting at the cursor, broken-code highlighting
 * (mismatched \begin/\end, unbalanced braces …) and folding for
 * environments and sections. Analysis is @devtex/core's analyzeStructure.
 */
import { foldService, type Language } from '@codemirror/language';
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { analyzeStructure, enclosingPair, pairAtTag, type StructureAnalysis } from '@devtex/core';

/** Cached analysis per document version. */
export const structureField = StateField.define<StructureAnalysis>({
  create: (state) => analyzeStructure(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? analyzeStructure(tr.state.doc.toString()) : value),
});

const pairMark = Decoration.mark({ class: 'cm-dt-env-pair' });
const brokenMark = Decoration.mark({ class: 'cm-dt-broken' });

export function structureDecorations(state: EditorState): DecorationSet {
  const a = state.field(structureField);
  const head = state.selection.main.head;
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  const pair = pairAtTag(a.pairs, head) ?? enclosingPair(a.pairs, head);
  if (pair !== undefined) {
    marks.push({ ...pair.begin, deco: pairMark }, { ...pair.end, deco: pairMark });
  }
  for (const p of a.problems)
    if (p.to > p.from) marks.push({ from: p.from, to: p.to, deco: brokenMark });
  marks.sort((x, y) => x.from - y.from || x.to - y.to);
  const b = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const m of marks) {
    if (m.from < last) continue; // RangeSetBuilder requires sorted, non-overlapping adds here
    b.add(m.from, m.to, m.deco);
    last = m.to;
  }
  return b.finish();
}

const decorationsField = StateField.define<DecorationSet>({
  create: (state) => structureDecorations(state),
  update: (value, tr) => (tr.docChanged || tr.selection ? structureDecorations(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

/** Fold range for the line at `lineStart`: a \begin…\end pair or a section up to the next same-or-higher heading. */
export function foldRangeAt(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const a = state.field(structureField, false) ?? analyzeStructure(state.doc.toString());
  const pair = a.pairs.find((p) => p.begin.from >= lineStart && p.begin.from <= lineEnd);
  if (pair !== undefined) {
    const endLine = state.doc.lineAt(pair.end.from);
    if (endLine.from > lineEnd)
      return {
        from: pair.begin.to,
        to: endLine.from - 1 < pair.begin.to ? pair.begin.to : endLine.from - 1,
      };
  }
  const line = state.doc.lineAt(lineStart);
  const SECTION_ORDER = [
    'part',
    'chapter',
    'section',
    'subsection',
    'subsubsection',
    'paragraph',
    'subparagraph',
  ];
  const m =
    /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?[[{]/.exec(
      line.text,
    );
  if (m?.[1] === undefined) return null;
  const level = SECTION_ORDER.indexOf(m[1]);
  let end = state.doc.length;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const h =
      /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?[[{]/.exec(
        l.text,
      );
    if (
      (h?.[1] !== undefined && SECTION_ORDER.indexOf(h[1]) <= level) ||
      /^\s*\\end\s*\{document\}/.test(l.text)
    ) {
      end = l.from - 1;
      break;
    }
  }
  return end > line.to ? { from: line.to, to: end } : null;
}

export function structure(_language?: Language): Extension {
  return [
    structureField,
    decorationsField,
    foldService.of((state, from, to) => foldRangeAt(state, from, to)),
    EditorView.baseTheme({
      '.cm-dt-env-pair': {
        backgroundColor: 'var(--dt-env-pair, rgba(80,160,255,0.25))',
        borderRadius: '2px',
      },
      '.cm-dt-broken': {
        backgroundColor: 'var(--dt-broken, rgba(230,60,60,0.35))',
        textDecoration: 'underline wavy',
      },
    }),
  ];
}
