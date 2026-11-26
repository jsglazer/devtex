/**
 * syntax/*.json: custom highlighting rules for LaTeX and embedded code.
 *
 *   {
 *     "name": "my-macros",
 *     "scope": "latex",                 // or "embedded"
 *     "environments": ["rcode"],        // embedded: env bodies to highlight
 *     "rules": [ { "match": "\\\\todo\\b", "token": "todo", "color": "#d33", "fontStyle": "bold" } ]
 *   }
 *
 * `color` and `fontStyle` are optional: without them a rule only gets the
 * class `.cm-dt-syn-<name>-<token>`, for a style profile to style.
 * Rules with invalid regexes are dropped and reported; invalid colours are ignored.
 */
import { parseJsoncText, type Loaded } from './settings.js';

export interface SyntaxRule {
  match: string;
  flags: string;
  token: string;
  color?: string;
  fontStyle?: 'normal' | 'italic' | 'bold' | 'underline';
}

export interface SyntaxDefinition {
  name: string;
  scope: 'latex' | 'embedded';
  environments: string[];
  rules: SyntaxRule[];
}

const TOKEN_RE = /^[a-zA-Z][\w-]*$/;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|[a-zA-Z]+)$/;

export function loadSyntaxFile(fileName: string, text: string): Loaded<SyntaxDefinition | null> {
  const errors: string[] = [];
  const raw = parseJsoncText(text, fileName, errors);
  if (raw === undefined) return { value: null, errors };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`${fileName}: expected an object`);
    return { value: null, errors };
  }
  const r = raw as Record<string, unknown>;
  const scope = r['scope'] === 'embedded' ? 'embedded' : 'latex';
  const envs = Array.isArray(r['environments'])
    ? (r['environments'] as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];
  const rules: SyntaxRule[] = [];
  const rawRules = Array.isArray(r['rules']) ? (r['rules'] as unknown[]) : [];
  rawRules.forEach((rule, i) => {
    if (typeof rule !== 'object' || rule === null) {
      errors.push(`${fileName}: rules[${i}] is not an object`);
      return;
    }
    const x = rule as Record<string, unknown>;
    const match = x['match'];
    const token = x['token'];
    const flags = typeof x['flags'] === 'string' ? x['flags'].replace(/[^imsu]/g, '') : '';
    if (typeof match !== 'string' || match === '') {
      errors.push(`${fileName}: rules[${i}].match must be a non-empty regex string`);
      return;
    }
    try {
      new RegExp(match, flags);
    } catch (e) {
      errors.push(
        `${fileName}: rules[${i}].match is not a valid regex (${e instanceof Error ? e.message : String(e)})`,
      );
      return;
    }
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      errors.push(`${fileName}: rules[${i}].token must be an identifier`);
      return;
    }
    const out: SyntaxRule = { match, flags, token };
    if (typeof x['color'] === 'string') {
      if (COLOR_RE.test(x['color'])) out.color = x['color'];
      else errors.push(`${fileName}: rules[${i}].color is not a CSS colour (ignored)`);
    }
    const fs = x['fontStyle'];
    if (fs === 'normal' || fs === 'italic' || fs === 'bold' || fs === 'underline')
      out.fontStyle = fs;
    rules.push(out);
  });
  const name = typeof r['name'] === 'string' ? r['name'] : fileName.replace(/\.json$/, '');
  return { value: { name, scope, environments: envs, rules }, errors };
}
