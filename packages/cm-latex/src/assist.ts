/**
 * Completion and lint sources wired to @devtex/core's engines. Project
 * knowledge (labels, citekeys, macros) is supplied by the host through a
 * provider so the same extension runs in the app and in Obsidian.
 */
import {
  autocompletion,
  snippetCompletion,
  type CompletionContext,
  type CompletionResult as CmResult,
  type Completion,
} from '@codemirror/autocomplete';
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import {
  complete,
  diagnose,
  enclosingPair,
  type CitationInfo,
  type CompletionOption,
  type MacroSet,
} from '@devtex/core';
import { structureField } from './structure.js';

export interface ProjectKnowledge {
  labels(): readonly string[];
  citations(): readonly CitationInfo[];
  /** null when no citation source is available (skip unknown-citekey checks). */
  citekeys(): ReadonlySet<string> | null;
  macros(): MacroSet;
  /** Extra diagnostics (e.g. latexmk log) for the current document. */
  external?(): readonly {
    from: number;
    to: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }[];
}

/** `|` cursor marker -> CodeMirror snippet `${}` field. */
export function toSnippet(apply: string): string {
  const escaped = apply.replace(/[{}]/g, (c) => (c === '{' ? '\\{' : '\\}')).replace(/\$/g, '\\$');
  return escaped.includes('|') ? escaped.replace('|', '${}') : `${escaped}\${}`;
}

export function toCompletion(o: CompletionOption): Completion {
  const base: Completion = {
    label: o.label,
    type:
      o.kind === 'environment'
        ? 'type'
        : o.kind === 'citation'
          ? 'constant'
          : o.kind === 'label'
            ? 'variable'
            : 'keyword',
  };
  if (o.detail !== undefined) base.detail = o.detail;
  if (o.apply.includes('|') || o.apply.includes('\n'))
    return snippetCompletion(toSnippet(o.apply), base);
  return { ...base, apply: o.apply };
}

export function latexCompletionSource(knowledge: ProjectKnowledge) {
  return (ctx: CompletionContext): CmResult | null => {
    const pairs = ctx.state.field(structureField, false)?.pairs ?? [];
    const open = enclosingPair(pairs, ctx.pos);
    const r = complete({
      text: ctx.state.doc.toString(),
      pos: ctx.pos,
      labels: knowledge.labels(),
      citations: knowledge.citations(),
      macros: knowledge.macros(),
      ...(open !== undefined ? { openEnv: open.name } : {}),
    });
    if (r === null) return null;
    if (r.from === ctx.pos && !ctx.explicit && r.options.length === 0) return null;
    return {
      from: r.from,
      options: r.options.slice(0, 200).map(toCompletion),
      validFor: /^[\w:@-]*$/,
    };
  };
}

export function latexLinter(knowledge: ProjectKnowledge): Extension {
  return linter(
    (view) => {
      const text = view.state.doc.toString();
      const out: CmDiagnostic[] = diagnose(text, {
        labels: new Set(knowledge.labels()),
        citekeys: knowledge.citekeys(),
      }).map((d) => ({
        from: d.from,
        to: Math.max(d.to, d.from + 1),
        severity: d.severity,
        message: d.message,
        source: d.source,
      }));
      for (const e of knowledge.external?.() ?? []) out.push({ ...e, source: 'latexmk' });
      return out.filter((d) => d.from <= text.length && d.to <= text.length);
    },
    { delay: 400 },
  );
}

export function latexAssist(knowledge: ProjectKnowledge): Extension {
  return [
    autocompletion({ override: [latexCompletionSource(knowledge)], activateOnTyping: true }),
    latexLinter(knowledge),
  ];
}
