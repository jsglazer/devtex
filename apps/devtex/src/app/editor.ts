/**
 * Source editor: one CodeMirror 6 view, one EditorState per open file.
 * Shortcuts come from keymap.json (reserved keys already rejected by core);
 * fonts and highlight colours from settings.jsonc.
 */
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import {
  addCursorAbove,
  addCursorBelow,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  toggleComment,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldEffect,
  foldedRanges,
  foldGutter,
  foldKeymap,
  foldCode,
  unfoldCode,
  unfoldEffect,
} from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import {
  findNext,
  findPrevious,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  selectNextOccurrence,
} from '@codemirror/search';
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding as CmKeyBinding,
} from '@codemirror/view';
import { latex, type ProjectKnowledge } from '@devtex/cm-latex';
import {
  toCodeMirrorKey,
  type KeyBinding,
  type Settings,
  type SyntaxDefinition,
} from '@devtex/core';

export interface EditorHost {
  knowledge: ProjectKnowledge;
  onChange(path: string, text: string): void;
  onCursor(path: string, line: number): void;
  runCommand(id: string): boolean;
}

/** Editor-local commands that CodeMirror implements directly. */
export const CM_COMMANDS: Record<string, (v: EditorView) => boolean> = {
  'search.find': openSearchPanel,
  'search.replace': openSearchPanel,
  'search.next': findNext,
  'search.previous': findPrevious,
  'edit.toggleComment': toggleComment,
  'edit.fold': foldCode,
  'edit.unfold': unfoldCode,
  'edit.selectNextOccurrence': selectNextOccurrence,
  'edit.addCursorAbove': addCursorAbove,
  'edit.addCursorBelow': addCursorBelow,
  'edit.moveLineUp': moveLineUp,
  'edit.moveLineDown': moveLineDown,
};

export function themeFor(s: Settings): Extension {
  return EditorView.theme({
    '&': { fontSize: `${s.editor.fontSize}px`, height: '100%' },
    '.cm-content, .cm-gutter': {
      fontFamily: s.editor.fontFamily,
      lineHeight: String(s.editor.lineHeight),
    },
    '.cm-activeLine': { backgroundColor: s.colors.currentLine },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: s.colors.matchingBracket },
    '.cm-selectionMatch': { backgroundColor: s.colors.selectionMatch },
    '.cm-dt-broken': { backgroundColor: s.colors.brokenCode },
    '.cm-dt-env-pair': { backgroundColor: s.colors.environmentPair },
  });
}

export class SourceEditor {
  readonly view: EditorView;
  private readonly states = new Map<string, EditorState>();
  private current = '';
  private readonly theme = new Compartment();
  private readonly keys = new Compartment();
  private readonly lang = new Compartment();
  private readonly wrap = new Compartment();
  private settings: Settings;
  private bindings: KeyBinding[];
  private syntax: readonly SyntaxDefinition[];
  private suppress = false;

  constructor(
    parent: HTMLElement,
    private readonly host: EditorHost,
    settings: Settings,
    bindings: KeyBinding[],
    syntax: readonly SyntaxDefinition[],
  ) {
    this.settings = settings;
    this.bindings = bindings;
    this.syntax = syntax;
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: '', extensions: this.extensions() }),
    });
  }

  private userKeymap(): CmKeyBinding[] {
    return this.bindings.map((b) => ({
      key: toCodeMirrorKey(b.key),
      preventDefault: true,
      run: (v: EditorView) => {
        const local = CM_COMMANDS[b.command];
        if (local) return local(v);
        return this.host.runCommand(b.command);
      },
    }));
  }

  private extensions(): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
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
      this.lang.of(latex({ knowledge: this.host.knowledge, syntax: this.syntax })),
      this.keys.of(keymap.of(this.userKeymap())),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      this.theme.of(themeFor(this.settings)),
      this.wrap.of(this.wrapExtension()),
      EditorView.updateListener.of((u) => {
        if (this.suppress || this.current === '') return;
        if (u.docChanged) this.host.onChange(this.current, u.state.doc.toString());
        if (u.selectionSet || u.docChanged)
          this.host.onCursor(this.current, u.state.doc.lineAt(u.state.selection.main.head).number);
      }),
    ];
  }

  private wrapExtension(): Extension {
    return this.settings.editor.lineWrapping ? EditorView.lineWrapping : [];
  }

  /** Turn soft word wrap on/off for every open file (keeps undo history). */
  setLineWrapping(on: boolean): void {
    this.settings.editor.lineWrapping = on;
    this.view.dispatch({ effects: this.wrap.reconfigure(this.wrapExtension()) });
  }

  get path(): string {
    return this.current;
  }

  /** Show `path`, creating its state from `text` the first time. */
  open(path: string, text: string): void {
    if (this.current !== '') this.states.set(this.current, this.view.state);
    let st = this.states.get(path);
    if (st === undefined || st.doc.toString() !== text) {
      st = EditorState.create({ doc: text, extensions: this.extensions() });
    }
    this.current = path;
    this.suppress = true;
    this.view.setState(st);
    // a cached state may predate a word-wrap toggle
    this.view.dispatch({ effects: this.wrap.reconfigure(this.wrapExtension()) });
    this.suppress = false;
  }

  /** Replace a file's text from disk (reload), keeping the cursor line where possible. */
  replaceText(path: string, text: string): void {
    if (path !== this.current) {
      this.states.delete(path);
      return;
    }
    const head = Math.min(this.view.state.selection.main.head, text.length);
    this.suppress = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: head },
    });
    this.suppress = false;
  }

  goTo(line: number, flash = true): void {
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    this.view.dispatch({
      selection: { anchor: l.from },
      effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
    });
    this.view.focus();
    if (flash) {
      const dom = this.view.domAtPos(l.from).node;
      const lineEl =
        dom instanceof HTMLElement
          ? dom.closest('.cm-line')
          : dom.parentElement?.closest('.cm-line');
      lineEl?.classList.add('dt-flash');
      setTimeout(() => lineEl?.classList.remove('dt-flash'), 1200);
    }
  }

  /**
   * Fold (or unfold) the preamble: everything after the first line up to the
   * line before \begin{document}. Returns false when the file has no preamble.
   */
  togglePreamble(): boolean {
    const range = preambleRange(this.view.state.doc);
    if (range === null) return false;
    let folded = false;
    foldedRanges(this.view.state).between(range.from, range.to, (from, to) => {
      if (from === range.from && to === range.to) folded = true;
    });
    this.view.dispatch({ effects: (folded ? unfoldEffect : foldEffect).of(range) });
    return true;
  }

  /**
   * Line at the top of the visible editor area, fractional: 12.5 means half
   * way through line 12 (wrapped lines count by height).
   */
  topLine(): number {
    const v = this.view;
    // distance from the top of the document to the top of the visible area
    const h = Math.max(0, v.scrollDOM.getBoundingClientRect().top - v.documentTop);
    const block = v.lineBlockAtHeight(h);
    const n = v.state.doc.lineAt(block.from).number;
    return (
      n + (block.height > 0 ? Math.min(0.999, Math.max(0, (h - block.top) / block.height)) : 0)
    );
  }

  cursorLine(): number {
    return this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
  }

  reconfigure(
    settings: Settings,
    bindings: KeyBinding[],
    syntax: readonly SyntaxDefinition[],
  ): void {
    this.settings = settings;
    this.bindings = bindings;
    this.syntax = syntax;
    this.view.dispatch({
      effects: [
        this.theme.reconfigure(themeFor(settings)),
        this.keys.reconfigure(keymap.of(this.userKeymap())),
        this.lang.reconfigure(latex({ knowledge: this.host.knowledge, syntax })),
        this.wrap.reconfigure(this.wrapExtension()),
      ],
    });
    this.states.clear();
  }

  forget(path: string): void {
    this.states.delete(path);
  }
}

/** Preamble fold range: end of line 1 to the end of the line before \begin{document}. */
export function preambleRange(doc: Text): { from: number; to: number } | null {
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (/^\s*\\begin\s*\{document\}/.test(text)) {
      if (n <= 2) return null;
      return { from: doc.line(1).to, to: doc.line(n - 1).to };
    }
  }
  return null;
}
