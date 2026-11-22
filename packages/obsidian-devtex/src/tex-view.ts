/**
 * Editor view for .tex files inside Obsidian: CodeMirror 6 with the shared
 * DevTex LaTeX extensions. Saving goes through TextFileView.requestSave, so
 * Obsidian's own file handling (and Obsidian Sync) applies.
 */
import { closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { latex, type ProjectKnowledge } from '@devtex/cm-latex';
import { collectMacros, labelsOf, outlineOf } from '@devtex/core';
import { TextFileView, type WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_TEX = 'devtex-tex';

/** Knowledge from the open file only (the plugin is an editor, not a project tool). */
export function fileKnowledge(getText: () => string): ProjectKnowledge {
  return {
    labels: () => labelsOf(outlineOf('current.tex', getText())),
    citations: () => [],
    citekeys: () => null,
    macros: () => collectMacros([getText()]),
  };
}

export function texExtensions(getText: () => string, onChange: () => void): Extension {
  return [
    lineNumbers(),
    foldGutter(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    latex({ knowledge: fileKnowledge(getText) }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange();
    }),
  ];
}

export class TexView extends TextFileView {
  private editor: EditorView | null = null;
  private loading = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_TEX;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? 'LaTeX';
  }

  override getIcon(): string {
    return 'sigma';
  }

  override onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('devtex-view');
    this.editor = new EditorView({
      parent: this.contentEl,
      state: EditorState.create({
        doc: this.data,
        extensions: texExtensions(
          () => this.editor?.state.doc.toString() ?? '',
          () => {
            if (!this.loading) this.requestSave();
          },
        ),
      }),
    });
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.editor?.destroy();
    this.editor = null;
    return Promise.resolve();
  }

  override getViewData(): string {
    return this.editor?.state.doc.toString() ?? this.data;
  }

  override setViewData(data: string, clear: boolean): void {
    this.data = data;
    const ed = this.editor;
    if (ed === null) return;
    this.loading = true;
    try {
      if (clear) {
        ed.setState(
          EditorState.create({
            doc: data,
            extensions: texExtensions(
              () => ed.state.doc.toString(),
              () => {
                if (!this.loading) this.requestSave();
              },
            ),
          }),
        );
      } else if (ed.state.doc.toString() !== data) {
        ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: data } });
      }
    } finally {
      this.loading = false;
    }
  }

  override clear(): void {
    this.setViewData('', true);
  }
}
