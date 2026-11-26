/**
 * Style profiles: plain `.css` files in `themes/` (next to `syntax/`) that set
 * the documented `--dt-*` variables (the stable contract) and may restyle
 * anything else. Profiles come in light/dark pairs (`ui.theme` and
 * `ui.themeDark`); an optional `themes/user.css` overrides any profile.
 *
 * Pure: no DOM. The app loads the text, wraps it in `@layer profile` / `@layer
 * user` and decides which profile to show.
 */

export type StyleGroup = 'app' | 'editor' | 'syntax' | 'preview' | 'pdf';

export interface StyleVariable {
  name: `--dt-${string}`;
  group: StyleGroup;
  description: string;
}

const v = (name: `--dt-${string}`, group: StyleGroup, description: string): StyleVariable => ({
  name,
  group,
  description,
});

/** The documented variables, in README order. Only these are a stable promise across versions. */
export const STYLE_VARIABLES: readonly StyleVariable[] = [
  v('--dt-bg', 'app', 'Window and editor-tab background'),
  v('--dt-fg', 'app', 'Main text colour'),
  v('--dt-muted', 'app', 'Secondary text (status bar, labels, gutter numbers)'),
  v('--dt-border', 'app', 'Dividers and control borders'),
  v('--dt-panel', 'app', 'Toolbars, tab bars, Outline, Problems and status bar'),
  v('--dt-accent', 'app', 'Accent colour (primary buttons, links, Beamer titles)'),
  v('--dt-accent-fg', 'app', 'Text drawn on the accent colour'),
  v('--dt-error', 'app', 'Errors, broken math, deleted diff lines, Beamer alerts'),
  v('--dt-warning', 'app', 'Warnings'),
  v('--dt-success', 'app', 'Added diff lines, Beamer example blocks'),
  v('--dt-sync', 'app', 'Sync highlight (Preview block, PDF box, editor flash)'),
  v('--dt-shadow', 'app', 'Shadow colour for dialogs, slides and PDF pages'),
  v('--dt-font', 'app', 'Interface font family'),
  v('--dt-font-size', 'app', 'Interface font size'),
  v('--dt-mono-font', 'app', 'Monospace font for file locations and code'),
  v('--dt-editor-font', 'editor', 'Editor font family'),
  v('--dt-editor-size', 'editor', 'Editor font size'),
  v('--dt-editor-line-height', 'editor', 'Editor line height'),
  v('--dt-editor-bg', 'editor', 'Editor background'),
  v('--dt-editor-fg', 'editor', 'Editor text'),
  v('--dt-editor-gutter', 'editor', 'Line-number gutter background'),
  v('--dt-editor-cursor', 'editor', 'Cursor colour'),
  v('--dt-editor-selection', 'editor', 'Selection background'),
  v('--dt-editor-active-line', 'editor', 'Current-line highlight'),
  v('--dt-editor-matching-bracket', 'editor', 'Matching-bracket highlight'),
  v('--dt-editor-selection-match', 'editor', 'Other occurrences of the selection'),
  v('--dt-editor-broken', 'editor', 'Unbalanced \\begin/\\end and braces'),
  v('--dt-editor-env-pair', 'editor', 'The \\begin/\\end pair around the cursor'),
  v('--dt-syntax-command', 'syntax', 'LaTeX commands'),
  v('--dt-syntax-env', 'syntax', 'Environment names'),
  v('--dt-syntax-atom', 'syntax', 'Atoms (e.g. & and special characters)'),
  v('--dt-syntax-comment', 'syntax', 'Comments'),
  v('--dt-syntax-math', 'syntax', 'Math'),
  v('--dt-syntax-number', 'syntax', 'Numbers and lengths'),
  v('--dt-syntax-bracket', 'syntax', 'Brackets and braces'),
  v('--dt-syntax-meta', 'syntax', 'Meta tokens'),
  v('--dt-syntax-error', 'syntax', 'Invalid tokens'),
  v('--dt-preview-font', 'preview', 'Preview body font family'),
  v('--dt-preview-size', 'preview', 'Preview body font size'),
  v('--dt-preview-line-height', 'preview', 'Preview line height'),
  v('--dt-preview-heading-font', 'preview', 'Preview heading font family'),
  v('--dt-preview-fg', 'preview', 'Preview text'),
  v('--dt-preview-bg', 'preview', 'Preview background'),
  v('--dt-preview-link', 'preview', 'Links, citations and references in the Preview'),
  v('--dt-preview-math', 'preview', 'Typeset math colour'),
  v('--dt-pdf-bg', 'pdf', 'Area around the PDF pages'),
  v('--dt-pdf-shadow', 'pdf', 'Page shadow (a box-shadow value)'),
  v(
    '--dt-pdf-filter',
    'pdf',
    'CSS filter for the pages, empty by default (e.g. a dark profile can dim them)',
  ),
];

export const STYLE_VARIABLE_NAMES: ReadonlySet<string> = new Set(
  STYLE_VARIABLES.map((x) => x.name),
);

export type Appearance = 'light' | 'dark';

/** Which slot a profile fills. */
export type ProfileSlot = 'light' | 'dark';

export const THEMES_DIR = 'themes';
export const USER_CSS = `${THEMES_DIR}/user.css`;
export const DEFAULT_PROFILES: Readonly<Record<ProfileSlot, string>> = {
  light: 'Default Light',
  dark: 'Default Dark',
};

/** Profile names: what the file system and the Rust whitelist both accept. */
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name) && !name.includes('..') && name.toLowerCase() !== 'user';
}

/** `Paper Light` -> `themes/Paper Light.css`. */
export function profileFile(name: string): string {
  return `${THEMES_DIR}/${name}.css`;
}

/** `themes/Paper Light.css` -> `Paper Light`; null for `user.css` and non-profile names. */
export function profileNameOf(file: string): string | null {
  const m = /^themes\/(.+)\.css$/.exec(file);
  if (m?.[1] === undefined || !isValidProfileName(m[1])) return null;
  return m[1];
}

/** `/* devtex: appearance=dark *\/` anywhere in the profile (normally its first line). */
export function profileAppearance(css: string): Appearance | null {
  const m = /\/\*\s*devtex:\s*appearance\s*=\s*(light|dark)\s*\*\//i.exec(css);
  return m?.[1] === undefined ? null : (m[1].toLowerCase() as Appearance);
}

/** The slot to show for the system appearance. */
export function activeSlot(systemDark: boolean): ProfileSlot {
  return systemDark ? 'dark' : 'light';
}

/** Profile name configured for a slot (`ui.theme` / `ui.themeDark`). */
export function profileForSlot(
  ui: { theme: string; themeDark: string },
  slot: ProfileSlot,
): string {
  const name = slot === 'dark' ? ui.themeDark : ui.theme;
  return isValidProfileName(name) ? name : DEFAULT_PROFILES[slot];
}

/**
 * Native window appearance to force for a profile: null (follow the system)
 * when the profile has no header or already matches the system.
 */
export function forcedAppearance(css: string, systemDark: boolean): Appearance | null {
  const a = profileAppearance(css);
  if (a === null) return null;
  return (a === 'dark') === systemDark ? null : a;
}

/**
 * A built-in family name from a profile name: `Paper Light` -> `Paper`.
 * Used by View ▸ Style Profile, which sets both slots at once.
 */
export function familyOf(name: string): string {
  return name.replace(/\s+(Light|Dark)$/, '');
}

/** Profile names in `themes/`, from a file listing, sorted, without `user.css`. */
export function profileNames(files: readonly string[]): string[] {
  return [...new Set(files.map(profileNameOf).filter((n): n is string => n !== null))].sort(
    (a, b) => a.localeCompare(b),
  );
}

// ---------- CSS text helpers ----------

/**
 * A value safe to write into a declaration: no way to close the rule, start a
 * comment or another declaration, or break out of the `<style>` element.
 */
export function isSafeCssValue(value: string): boolean {
  const s = value.trim();
  return s !== '' && s.length <= 300 && !/[;{}<>\\]|\/\*|\*\//.test(s);
}

/** Wrap a stylesheet in a cascade layer. Leading `@charset`/`@import` lines are dropped (not allowed inside a layer). */
export function wrapInLayer(css: string, layer: string): string {
  const body = css.replace(/^\s*@(?:charset|import)\b[^;]*;\s*/gm, '');
  return `@layer ${layer} {\n${body}\n}\n`;
}

export const MANAGED_BEGIN =
  '/* devtex:managed:begin — written by the Settings dialog; edit outside this block */';
export const MANAGED_END = '/* devtex:managed:end */';

const MANAGED_RE = /\/\* devtex:managed:begin[^*]*\*\/([\s\S]*?)\/\* devtex:managed:end \*\//;

/** Variable overrides inside the DevTex-managed block of user.css. */
export function readManagedBlock(css: string | null): Map<string, string> {
  const out = new Map<string, string>();
  const body = css === null ? undefined : MANAGED_RE.exec(css)?.[1];
  if (body === undefined) return out;
  for (const m of body.matchAll(/(--dt-[\w-]+)\s*:\s*([^;}]+);/g)) {
    if (m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2].trim());
  }
  return out;
}

/**
 * Replace (or append) the managed block in user.css; everything outside it
 * is kept verbatim. An empty map removes the block's declarations.
 */
export function writeManagedBlock(css: string | null, vars: ReadonlyMap<string, string>): string {
  const decls = [...vars]
    .filter(([k, val]) => /^--dt-[\w-]+$/.test(k) && isSafeCssValue(val))
    .map(([k, val]) => `  ${k}: ${val.trim()};`)
    .join('\n');
  const block = `${MANAGED_BEGIN}\n:root {\n${decls}${decls === '' ? '' : '\n'}}\n${MANAGED_END}`;
  const text = css ?? USER_CSS_TEMPLATE;
  if (MANAGED_RE.test(text)) return text.replace(MANAGED_RE, block);
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`;
}

export const USER_CSS_TEMPLATE = `/* DevTex user.css: overrides every style profile.
   Set any --dt-* variable here (see the README for the list), or add your own rules. */
`;

// ---------- migration from settings.jsonc (1.0.5) ----------

/** Pre-1.0.5 style keys in settings.jsonc and the variable each became. */
export const LEGACY_STYLE_KEYS: Readonly<Record<string, string>> = {
  'editor.fontFamily': '--dt-editor-font',
  'editor.fontSize': '--dt-editor-size',
  'editor.lineHeight': '--dt-editor-line-height',
  'colors.currentLine': '--dt-editor-active-line',
  'colors.matchingBracket': '--dt-editor-matching-bracket',
  'colors.brokenCode': '--dt-editor-broken',
  'colors.selectionMatch': '--dt-editor-selection-match',
  'colors.environmentPair': '--dt-editor-env-pair',
};

export interface LegacyStyle {
  /** Variable -> CSS value, for the keys that were present and valid. */
  vars: Map<string, string>;
  /** Settings keys found (moved, even when a value was unusable). */
  keys: string[];
}

/**
 * Pull the old style keys out of a parsed settings.jsonc object. Mutates
 * `raw` (removes them) so the settings merge does not report them as unknown.
 */
export function extractLegacyStyle(raw: unknown): LegacyStyle | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const vars = new Map<string, string>();
  const keys: string[] = [];
  for (const [key, variable] of Object.entries(LEGACY_STYLE_KEYS)) {
    const [group, prop] = key.split('.') as [string, string];
    const g = r[group];
    if (typeof g !== 'object' || g === null || Array.isArray(g)) continue;
    const obj = g as Record<string, unknown>;
    if (!(prop in obj)) continue;
    keys.push(key);
    const val = obj[prop];
    delete obj[prop];
    const css =
      typeof val === 'number' && Number.isFinite(val)
        ? prop === 'fontSize'
          ? `${val}px`
          : String(val)
        : typeof val === 'string'
          ? val
          : null;
    if (css !== null && isSafeCssValue(css)) vars.set(variable, css.trim());
  }
  if ('colors' in r && typeof r['colors'] === 'object' && r['colors'] !== null) {
    if (Object.keys(r['colors']).length === 0) delete r['colors'];
  }
  return keys.length === 0 ? null : { vars, keys };
}

/** A profile with the migrated values appended (they win over the profile's own `:root`). */
export function appendMigrated(profileCss: string, vars: ReadonlyMap<string, string>): string {
  if (vars.size === 0) return profileCss;
  const decls = [...vars].map(([k, val]) => `  ${k}: ${val};`).join('\n');
  return `${profileCss.replace(/\s*$/, '')}\n\n/* Migrated from settings.jsonc (colors / editor fonts) when DevTex 1.0.5 first ran. */\n:root {\n${decls}\n}\n`;
}
