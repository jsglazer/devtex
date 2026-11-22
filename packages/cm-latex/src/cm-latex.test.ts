import { CompletionContext } from '@codemirror/autocomplete';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { latexCompletionSource, toSnippet, type ProjectKnowledge } from './assist.js';
import { autoItemEnter, insertTemplate, wrapCommand, type CommandTarget } from './commands.js';
import { compileRules, customDecorations } from './custom-syntax.js';
import { latexSyntax } from './language.js';
import { structure, structureDecorations, structureField } from './structure.js';

function target(doc: string, extensions = [structure()]): CommandTarget & { get: () => string } {
  const pos = doc.indexOf('|');
  let state = EditorState.create({
    doc: doc.replace('|', ''),
    selection: { anchor: pos },
    extensions,
  });
  return {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
    get: () => {
      const s = state.doc.toString();
      const h = state.selection.main.head;
      return `${s.slice(0, h)}|${s.slice(h)}`;
    },
  };
}

describe('auto-\\item Enter command', () => {
  it('inserts a new item and moves the cursor', () => {
    const v = target('\\begin{itemize}\n  \\item a|\n\\end{itemize}');
    expect(autoItemEnter(v)).toBe(true);
    expect(v.get()).toBe('\\begin{itemize}\n  \\item a\n  \\item |\n\\end{itemize}');
  });
  it('ends the list on an empty item', () => {
    const v = target('\\begin{itemize}\n  \\item a\n  \\item |\n\\end{itemize}');
    autoItemEnter(v);
    expect(v.get()).toBe('\\begin{itemize}\n  \\item a\n\\end{itemize}\n|');
  });
  it('falls through outside lists and with multiple cursors', () => {
    expect(autoItemEnter(target('text|'))).toBe(false);
    const v = target('\\begin{itemize}\n\\item a|\n\\end{itemize}');
    v.dispatch(
      v.state.update({
        selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
      }),
    );
    expect(autoItemEnter(v)).toBe(false);
  });
});

describe('formatting commands', () => {
  it('wraps a selection or inserts an empty command', () => {
    const v = target('say |hi');
    wrapCommand('textbf')(v);
    expect(v.get()).toBe('say \\textbf{|}hi');
    const w = target('ab');
    w.dispatch(w.state.update({ selection: { anchor: 0, head: 2 } }));
    wrapCommand('emph')(w);
    expect(w.state.doc.toString()).toBe('\\emph{ab}');
  });
  it('inserts templates with indentation and cursor marker', () => {
    const v = target('  |');
    insertTemplate(v, '\\begin{center}\n  |\n\\end{center}');
    expect(v.get()).toBe('  \\begin{center}\n    |\n  \\end{center}');
  });
});

describe('structure analysis extension', () => {
  it('marks the env pair at the cursor and broken code', () => {
    const v = target('\\begin{quote}|x\\end{quote} \\end{itemize}');
    const set = structureDecorations(v.state);
    const classes: string[] = [];
    set.between(0, v.state.doc.length, (_f, _t, d) => {
      classes.push(String(d.spec.class));
    });
    expect(classes).toEqual(['cm-dt-env-pair', 'cm-dt-env-pair', 'cm-dt-broken']);
    expect(v.state.field(structureField).problems[0]?.kind).toBe('unopened-env');
  });
  it('folds environments and sections', () => {
    const doc =
      '\\section{A}\ntext\n\\begin{itemize}\n\\item x\n\\end{itemize}\n\\section{B}\nmore';
    const s = EditorState.create({ doc, extensions: [latexSyntax(), structure()] });
    const sec = foldable(s, 0, s.doc.line(1).to);
    expect(sec).toEqual({ from: s.doc.line(1).to, to: s.doc.line(5).to });
    const env = foldable(s, s.doc.line(3).from, s.doc.line(3).to);
    expect(env).toEqual({ from: s.doc.line(3).to, to: s.doc.line(4).to });
  });
});

describe('completion source', () => {
  const knowledge: ProjectKnowledge = {
    labels: () => ['sec:a', 'sec:b'],
    citations: () => [{ key: 'k1' }],
    citekeys: () => new Set(['k1']),
    macros: () => new Map(),
  };
  it('maps core results to CodeMirror completions', () => {
    const doc = 'see \\ref{sec';
    const state = EditorState.create({ doc, extensions: [structure()] });
    const r = latexCompletionSource(knowledge)(new CompletionContext(state, doc.length, false));
    expect(r?.from).toBe(9);
    expect(r?.options.map((o) => o.label)).toEqual(['sec:a', 'sec:b']);
  });
  it('converts cursor markers to snippet fields', () => {
    expect(toSnippet('\\textbf{|}')).toBe('\\textbf\\{${}\\}');
    expect(toSnippet('\\alpha')).toBe('\\alpha${}');
  });
});

describe('custom syntax rules', () => {
  it('decorates matches globally and only inside embedded environments', () => {
    const doc = 'TODO here\n\\begin{rcode}\nx <- 1 # TODO\n\\end{rcode}';
    const state = EditorState.create({ doc, extensions: [structure()] });
    const rules = compileRules([
      {
        name: 'notes',
        scope: 'latex',
        environments: [],
        rules: [{ match: 'TODO', flags: '', token: 'todo' }],
      },
      {
        name: 'r',
        scope: 'embedded',
        environments: ['rcode'],
        rules: [{ match: '<-', flags: '', token: 'assign' }],
      },
    ]);
    const found: [number, number, string][] = [];
    customDecorations(state, rules).between(0, doc.length, (f, t, d) => {
      found.push([f, t, String(d.spec.class)]);
    });
    expect(found.map((x) => doc.slice(x[0], x[1]))).toEqual(['TODO', '<-', 'TODO']);
    expect(found[1]?.[2]).toBe('cm-dt-syn-r-assign');
  });
});
