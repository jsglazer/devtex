/**
 * LaTeX language for CodeMirror 6 (stex stream mode) plus a highlight style.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

export const latexLanguage = StreamLanguage.define(stex);

export const latexHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--dt-syntax-command, #7c3aed)' },
  { tag: t.tagName, color: 'var(--dt-syntax-env, #0369a1)', fontWeight: '600' },
  { tag: t.atom, color: 'var(--dt-syntax-atom, #b45309)' },
  { tag: t.comment, color: 'var(--dt-syntax-comment, #6b7280)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--dt-syntax-math, #047857)' },
  { tag: t.number, color: 'var(--dt-syntax-number, #b91c1c)' },
  { tag: t.bracket, color: 'var(--dt-syntax-bracket, #475569)' },
  { tag: t.meta, color: 'var(--dt-syntax-meta, #be185d)' },
  { tag: t.invalid, color: 'var(--dt-syntax-error, #dc2626)' },
]);

export function latexSyntax(): Extension {
  return [latexLanguage, syntaxHighlighting(latexHighlightStyle)];
}
