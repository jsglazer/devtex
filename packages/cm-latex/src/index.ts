/**
 * @devtex/cm-latex — CodeMirror 6 LaTeX support shared by the DevTex app and
 * the companion Obsidian plugin: highlighting, environment matching and
 * broken-code marks, folding, auto-\item, completion, diagnostics and custom
 * syntax rules. All LaTeX logic lives in @devtex/core.
 */
import { Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { SyntaxDefinition } from '@devtex/core';
import { latexAssist, type ProjectKnowledge } from './assist.js';
import { autoItemEnter } from './commands.js';
import { customSyntax } from './custom-syntax.js';
import { latexSyntax } from './language.js';
import { structure } from './structure.js';

export * from './assist.js';
export * from './commands.js';
export * from './custom-syntax.js';
export * from './language.js';
export * from './structure.js';

export interface LatexOptions {
  knowledge?: ProjectKnowledge;
  syntax?: readonly SyntaxDefinition[];
}

export function latex(opts: LatexOptions = {}): Extension {
  return [
    latexSyntax(),
    structure(),
    Prec.high(keymap.of([{ key: 'Enter', run: autoItemEnter }])),
    opts.knowledge !== undefined ? latexAssist(opts.knowledge) : [],
    opts.syntax !== undefined && opts.syntax.length > 0 ? customSyntax(opts.syntax) : [],
  ];
}
