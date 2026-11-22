/**
 * In-editor completion engine (no texlab). Given the text before the cursor
 * and project knowledge (labels, citekeys, user macros, open environments),
 * returns candidates. Shared by macOS, iOS and the Obsidian plugin.
 */
import { COMMANDS, ENVIRONMENTS, envSnippet } from './completion-data.js';
import type { MacroSet } from './macros.js';

export type CompletionKind = 'command' | 'environment' | 'label' | 'citation';

export interface CompletionOption {
  label: string;
  kind: CompletionKind;
  /** Insert template; `|` marks the cursor. */
  apply: string;
  detail?: string;
}

export interface CompletionResult {
  /** Offset (in the document) where the replaced word starts. */
  from: number;
  options: CompletionOption[];
}

export interface CitationInfo {
  key: string;
  label?: string;
}

export interface CompletionContext {
  /** Full document text and cursor offset. */
  text: string;
  pos: number;
  labels: readonly string[];
  citations: readonly CitationInfo[];
  macros: MacroSet;
  /** Name of the innermost open environment at the cursor, if any. */
  openEnv?: string;
}

const CITE_RE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/;
const REF_RE = /\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref|vref)\{([^}]*)$/;
const BEGIN_RE = /\\(begin|end)\{([^}]*)$/;
const CMD_RE = /\\([A-Za-z@]*)$/;

function byPrefix<T extends { label: string }>(items: readonly T[], prefix: string): T[] {
  const p = prefix.toLowerCase();
  const starts = items.filter((i) => i.label.toLowerCase().startsWith(p));
  const contains = items.filter(
    (i) => !i.label.toLowerCase().startsWith(p) && p !== '' && i.label.toLowerCase().includes(p),
  );
  return [...starts, ...contains];
}

export function complete(ctx: CompletionContext): CompletionResult | null {
  const lineStart = ctx.text.lastIndexOf('\n', ctx.pos - 1) + 1;
  const before = ctx.text.slice(lineStart, ctx.pos);

  const cite = CITE_RE.exec(before);
  if (cite && cite[1] !== undefined) {
    const inside = cite[1];
    const part = inside.slice(inside.lastIndexOf(',') + 1);
    const word = part.trimStart();
    const opts = ctx.citations.map((c): CompletionOption => {
      const o: CompletionOption = { label: c.key, kind: 'citation', apply: c.key };
      if (c.label !== undefined) o.detail = c.label;
      return o;
    });
    return { from: ctx.pos - word.length, options: byPrefix(opts, word) };
  }

  const ref = REF_RE.exec(before);
  if (ref && ref[1] !== undefined) {
    const word = ref[1].slice(ref[1].lastIndexOf(',') + 1).trimStart();
    const opts = [...new Set(ctx.labels)]
      .sort()
      .map((l): CompletionOption => ({ label: l, kind: 'label', apply: l }));
    return { from: ctx.pos - word.length, options: byPrefix(opts, word) };
  }

  const env = BEGIN_RE.exec(before);
  if (env && env[2] !== undefined) {
    const word = env[2];
    if (env[1] === 'end') {
      const names =
        ctx.openEnv !== undefined
          ? [ctx.openEnv, ...ENVIRONMENTS.filter((e) => e !== ctx.openEnv)]
          : ENVIRONMENTS;
      const opts = names.map((e): CompletionOption => ({
        label: e,
        kind: 'environment',
        apply: e,
      }));
      return { from: ctx.pos - word.length, options: byPrefix(opts, word) };
    }
    // \begin{… : complete the whole environment (replaces from the backslash)
    const from = ctx.pos - word.length - '\\begin{'.length;
    const opts = ENVIRONMENTS.map((e): CompletionOption => ({
      label: e,
      kind: 'environment',
      apply: envSnippet(e),
      detail: 'environment',
    }));
    return { from, options: byPrefix(opts, word) };
  }

  const cmd = CMD_RE.exec(before);
  if (cmd && cmd[1] !== undefined) {
    const word = cmd[1];
    const user = [...ctx.macros.values()].map((d): CompletionOption => ({
      label: `\\${d.name}`,
      kind: 'command',
      apply:
        d.arity > 0 ? `\\${d.name}${'{}'.repeat(d.arity).replace('{}', '{|}')}` : `\\${d.name}`,
      detail: 'user macro',
    }));
    const builtin = COMMANDS.map((c): CompletionOption => {
      const o: CompletionOption = {
        label: `\\${c.name}`,
        kind: 'command',
        apply: c.snippet ?? `\\${c.name}`,
      };
      if (c.detail !== undefined) o.detail = c.detail;
      return o;
    });
    const seen = new Set<string>();
    const all = [...user, ...builtin].filter((o) =>
      seen.has(o.label) ? false : (seen.add(o.label), true),
    );
    const matches = byPrefix(all, `\\${word}`);
    if (matches.length === 0) return null;
    return { from: ctx.pos - word.length - 1, options: matches };
  }
  return null;
}
