/**
 * Custom syntax highlighting from syntax/*.json definitions: each rule's
 * regex becomes a mark decoration with a generated class. "embedded" rules
 * apply only inside the listed environments (e.g. code chunks).
 *
 * A rule may leave out `color` and `fontStyle`: it then only gets its class
 * (`.cm-dt-syn-<name>-<token>`), which a style profile styles. A colour given
 * in the JSON still applies, as the lowest-priority default.
 */
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SyntaxDefinition } from '@devtex/core';
import { structureField } from './structure.js';

export function ruleClass(def: SyntaxDefinition, token: string): string {
  return `cm-dt-syn-${def.name.replace(/[^\w-]/g, '_')}-${token}`;
}

interface CompiledRule {
  re: RegExp;
  deco: Decoration;
  envs: readonly string[] | null;
}

export function compileRules(defs: readonly SyntaxDefinition[]): CompiledRule[] {
  return defs.flatMap((def) =>
    def.rules.map((r) => ({
      re: new RegExp(r.match, `${r.flags.replace('g', '')}g`),
      deco: Decoration.mark({ class: ruleClass(def, r.token) }),
      envs: def.scope === 'embedded' ? def.environments : null,
    })),
  );
}

export function customDecorations(
  state: EditorState,
  rules: readonly CompiledRule[],
): DecorationSet {
  const text = state.doc.toString();
  const pairs = state.field(structureField, false)?.pairs ?? [];
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  for (const rule of rules) {
    const ranges =
      rule.envs === null
        ? [{ from: 0, to: text.length }]
        : pairs
            .filter((p) => rule.envs?.includes(p.name))
            .map((p) => ({ from: p.begin.to, to: p.end.from }));
    for (const range of ranges) {
      const slice = text.slice(range.from, range.to);
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = rule.re.exec(slice)) !== null && guard++ < 20000) {
        if (m[0].length === 0) {
          rule.re.lastIndex++;
          continue;
        }
        marks.push({
          from: range.from + m.index,
          to: range.from + m.index + m[0].length,
          deco: rule.deco,
        });
      }
    }
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  const b = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const m of marks) {
    if (m.from < last) continue;
    b.add(m.from, m.to, m.deco);
    last = m.to;
  }
  return b.finish();
}

export function customSyntax(defs: readonly SyntaxDefinition[]): Extension {
  const rules = compileRules(defs);
  const theme: Record<string, Record<string, string>> = {};
  for (const def of defs) {
    for (const r of def.rules) {
      const style: Record<string, string> = {};
      if (r.color !== undefined) style['color'] = r.color;
      if (r.fontStyle === 'bold') style['fontWeight'] = 'bold';
      if (r.fontStyle === 'italic') style['fontStyle'] = 'italic';
      if (r.fontStyle === 'underline') style['textDecoration'] = 'underline';
      if (Object.keys(style).length > 0) theme[`.${ruleClass(def, r.token)}`] = style;
    }
  }
  const field = StateField.define<DecorationSet>({
    create: (s) => customDecorations(s, rules),
    update: (v, tr) => (tr.docChanged ? customDecorations(tr.state, rules) : v),
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, EditorView.baseTheme(theme)];
}
