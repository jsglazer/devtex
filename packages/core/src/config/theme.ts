/**
 * Style profiles come from DevStyle (https://github.com/jsglazer/devstyle):
 * shared `--ds-*` tokens and light/dark profile pairs that every app reads from
 * one folder, so a style chosen in any app applies to all of them.
 *
 * DevTex's own stylesheets keep using the `--dt-*` variables. Each one is
 * defined in `@layer app-base` as the DevStyle token it stands for (see
 * STYLE_VARIABLES and aliasStylesheet), so a DevStyle profile restyles DevTex,
 * and `themes/user.css` in DevTex's config folder can still set any `--dt-*`.
 *
 * Pure: no DOM. Also holds the one-time migrations from DevTex 1.0.4 (style in
 * settings.jsonc) and 1.0.5–1.0.6 (DevTex's own profiles in themes/*.css).
 */
import { hashString } from '../hash.js';
import { parseCssColor } from './color.js';

export type StyleGroup = 'app' | 'editor' | 'syntax' | 'preview' | 'pdf';

export interface StyleVariable {
  name: `--dt-${string}`;
  group: StyleGroup;
  description: string;
  /** The DevStyle token (without `--ds-`) this variable stands for, or null for a DevTex-only variable. */
  ds: string | null;
  /** Value of a DevTex-only variable (null `ds`). */
  fallback?: string;
}

const v = (
  name: `--dt-${string}`,
  group: StyleGroup,
  ds: string | null,
  description: string,
  fallback?: string,
): StyleVariable =>
  fallback === undefined
    ? { name, group, ds, description }
    : { name, group, ds, description, fallback };

/** The documented variables, in README order. Only these are a stable promise across versions. */
export const STYLE_VARIABLES: readonly StyleVariable[] = [
  v('--dt-bg', 'app', 'bg', 'Window and editor-tab background'),
  v('--dt-fg', 'app', 'fg', 'Main text colour'),
  v('--dt-muted', 'app', 'muted', 'Secondary text (status bar, labels)'),
  v('--dt-border', 'app', 'border', 'Dividers and control borders'),
  v('--dt-panel', 'app', 'panel', 'Toolbars, tab bars, Outline, Problems and status bar'),
  v('--dt-accent', 'app', 'accent', 'Accent colour (primary buttons, links, Beamer titles)'),
  v('--dt-accent-fg', 'app', 'fg-on-accent', 'Text drawn on the accent colour'),
  v('--dt-error', 'app', 'error', 'Errors, broken math, deleted diff lines, Beamer alerts'),
  v('--dt-warning', 'app', 'warning', 'Warnings'),
  v('--dt-success', 'app', 'success', 'Added diff lines, Beamer example blocks'),
  v('--dt-sync', 'app', 'sync', 'Sync highlight (Preview block, PDF box, editor flash)'),
  v('--dt-shadow', 'app', 'overlay', 'Shadow and backdrop colour for dialogs and slides'),
  v('--dt-dialog-shadow', 'app', 'shadow', 'Dialog shadow (a box-shadow value)'),
  v('--dt-font', 'app', 'ui-font', 'Interface font family'),
  v('--dt-font-size', 'app', 'ui-size', 'Interface font size'),
  v('--dt-mono-font', 'app', 'mono-font', 'Monospace font for file locations and code'),
  v('--dt-editor-font', 'editor', 'mono-font', 'Editor font family'),
  v('--dt-editor-size', 'editor', 'mono-size', 'Editor font size'),
  v('--dt-editor-line-height', 'editor', 'mono-line-height', 'Editor line height'),
  v('--dt-editor-bg', 'editor', 'editor-bg', 'Editor background'),
  v('--dt-editor-fg', 'editor', 'editor-fg', 'Editor text'),
  v('--dt-editor-gutter', 'editor', 'gutter-bg', 'Line-number gutter background'),
  v('--dt-editor-gutter-fg', 'editor', 'gutter-fg', 'Line numbers'),
  v('--dt-editor-cursor', 'editor', 'cursor', 'Cursor colour'),
  v('--dt-editor-selection', 'editor', 'selection', 'Selection background'),
  v('--dt-editor-active-line', 'editor', 'active-line', 'Current-line highlight'),
  v('--dt-editor-matching-bracket', 'editor', 'matching-bracket', 'Matching-bracket highlight'),
  v(
    '--dt-editor-selection-match',
    'editor',
    'selection-match',
    'Other occurrences of the selection',
  ),
  v('--dt-editor-search-match', 'editor', 'search-match', 'Search matches'),
  v('--dt-editor-broken', 'editor', 'broken', 'Unbalanced \\begin/\\end and braces'),
  v('--dt-editor-env-pair', 'editor', 'pair-highlight', 'The \\begin/\\end pair around the cursor'),
  v('--dt-syntax-command', 'syntax', 'syn-keyword', 'LaTeX commands'),
  v('--dt-syntax-env', 'syntax', 'syn-env', 'Environment names'),
  v('--dt-syntax-atom', 'syntax', 'syn-atom', 'Atoms (e.g. & and special characters)'),
  v('--dt-syntax-comment', 'syntax', 'syn-comment', 'Comments'),
  v('--dt-syntax-math', 'syntax', 'syn-math', 'Math'),
  v('--dt-syntax-number', 'syntax', 'syn-number', 'Numbers and lengths'),
  v('--dt-syntax-bracket', 'syntax', 'syn-bracket', 'Brackets and braces'),
  v('--dt-syntax-meta', 'syntax', 'syn-meta', 'Meta tokens'),
  v('--dt-syntax-error', 'syntax', 'syn-error', 'Invalid tokens'),
  v('--dt-preview-font', 'preview', 'prose-font', 'Preview body font family'),
  v('--dt-preview-size', 'preview', 'prose-size', 'Preview body font size'),
  v('--dt-preview-line-height', 'preview', 'prose-line-height', 'Preview line height'),
  v('--dt-preview-heading-font', 'preview', 'heading-font', 'Preview heading font family'),
  v('--dt-preview-fg', 'preview', 'fg', 'Preview text'),
  v('--dt-preview-bg', 'preview', 'bg', 'Preview background'),
  v('--dt-preview-link', 'preview', 'link', 'Links, citations and references in the Preview'),
  v('--dt-preview-math', 'preview', null, 'Typeset math colour', 'currentColor'),
  v('--dt-pdf-bg', 'pdf', 'page-bg', 'Area around the PDF pages'),
  v('--dt-pdf-shadow', 'pdf', 'page-shadow', 'Page shadow (a box-shadow value)'),
  v(
    '--dt-pdf-filter',
    'pdf',
    'page-filter',
    'CSS filter for the pages (a dark profile can dim them)',
  ),
];

export const STYLE_VARIABLE_NAMES: ReadonlySet<string> = new Set(
  STYLE_VARIABLES.map((x) => x.name),
);

/** `:root { --dt-x: var(--ds-y); … }`: what DevTex puts in `@layer app-base`. */
export function aliasStylesheet(): string {
  const decls = STYLE_VARIABLES.map(
    (x) => `  ${x.name}: ${x.ds === null ? (x.fallback ?? 'initial') : `var(--ds-${x.ds})`};`,
  );
  return `:root {\n${decls.join('\n')}\n}\n`;
}

/**
 * Cascade layers, lowest first. `cm` holds CodeMirror's injected theme; the
 * other four are DevStyle's order (app defaults < shared profile < app
 * override < user.css).
 */
export const DEVTEX_LAYERS = ['cm', 'app-base', 'ds-profile', 'app-override', 'user'] as const;

export type Appearance = 'light' | 'dark';

/** Which slot a profile fills. */
export type ProfileSlot = 'light' | 'dark';

/** DevTex's own config folder: user.css, and the 1.0.5–1.0.6 profiles (migrated away). */
export const THEMES_DIR = 'themes';
export const USER_CSS = `${THEMES_DIR}/user.css`;

/** DevStyle profile ids used when nothing (valid) is chosen. */
export const DEFAULT_PROFILES: Readonly<Record<ProfileSlot, string>> = {
  light: 'default-light',
  dark: 'default-dark',
};

/** A DevStyle profile id: what the shared folder (and DevStyle's own loaders) accept. */
export function isProfileId(id: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(id);
}

/** A DevTex 1.0.5–1.0.6 profile name (`High Contrast Dark`), kept only for the migration. */
const LEGACY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

export function isLegacyProfileName(name: string): boolean {
  return LEGACY_NAME_RE.test(name) && !name.includes('..') && name.toLowerCase() !== 'user';
}

/** What `ui.theme` / `ui.themeDark` may hold: an id, or (until migrated) a 1.0.6 name. */
export function isProfileSetting(value: string): boolean {
  return isProfileId(value) || isLegacyProfileName(value);
}

/** The slot to show for the system appearance. */
export function activeSlot(systemDark: boolean): ProfileSlot {
  return systemDark ? 'dark' : 'light';
}

/** Profile id configured for a slot (`ui.theme` / `ui.themeDark`), or that slot's Default. */
export function profileForSlot(
  ui: { theme: string; themeDark: string },
  slot: ProfileSlot,
): string {
  const id = slot === 'dark' ? ui.themeDark : ui.theme;
  return isProfileId(id) ? id : DEFAULT_PROFILES[slot];
}

/**
 * Native window appearance to force for a profile: null (follow the system)
 * when the profile's appearance is unknown or already matches the system.
 */
export function forcedAppearance(own: Appearance | null, systemDark: boolean): Appearance | null {
  if (own === null) return null;
  return (own === 'dark') === systemDark ? null : own;
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

export const USER_CSS_TEMPLATE = `/* DevTex user.css: overrides every style profile, in DevTex only.
   Set any --dt-* variable here (see the README for the list), or add your own rules.
   To change the look of every app, edit or add a DevStyle profile instead. */
`;

/** Loosely equal CSS values: colours by their RGBA, anything else ignoring quotes, case and spaces. */
export function sameCssValue(a: string, b: string): boolean {
  const ca = parseCssColor(a.trim());
  const cb = parseCssColor(b.trim());
  if (ca !== null && cb !== null)
    return ca.r === cb.r && ca.g === cb.g && ca.b === cb.b && Math.abs(ca.a - cb.a) < 0.005;
  const norm = (s: string): string => s.replace(/['"\s]/g, '').toLowerCase();
  return norm(a) === norm(b);
}

// ---------- migration from settings.jsonc (DevTex 1.0.4) ----------

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

/**
 * DevTex 1.0.4's default values for those keys. A setting still at its old
 * default is not a choice the user made, so it is not carried over (it would
 * otherwise pin a light-mode colour over every dark profile).
 */
export const LEGACY_SETTING_DEFAULTS: Readonly<Record<string, string>> = {
  '--dt-editor-font': 'SF Mono, Menlo, monospace',
  '--dt-editor-size': '14px',
  '--dt-editor-line-height': '1.5',
  '--dt-editor-active-line': 'rgba(120, 120, 180, 0.10)',
  '--dt-editor-matching-bracket': 'rgba(80, 200, 120, 0.35)',
  '--dt-editor-broken': 'rgba(230, 60, 60, 0.35)',
  '--dt-editor-selection-match': 'rgba(255, 210, 0, 0.25)',
  '--dt-editor-env-pair': 'rgba(80, 160, 255, 0.25)',
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

/** The migrated values the user actually changed (not still at DevTex 1.0.4's defaults). */
export function changedLegacyVars(vars: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, val] of vars) {
    const def = LEGACY_SETTING_DEFAULTS[k];
    if (def === undefined || !sameCssValue(val, def)) out.set(k, val);
  }
  return out;
}

// ---------- migration from DevTex's own profiles (DevTex 1.0.5–1.0.6) ----------

/** hashString() of each profile DevTex 1.0.5–1.0.6 shipped, to spot untouched copies. */
export const LEGACY_BUILTIN_HASHES: Readonly<Record<string, string>> = {
  'Default Dark': 'c5yrgspcmd',
  'Default Light': '1nl2o82yoew',
  'High Contrast Dark': '1ep5vljkzoj',
  'High Contrast Light': '19dq9xkgpyx',
  'Paper Dark': '1p1e30hd6c7',
  'Paper Light': '1y8dke9ytd9',
  'Solarized Dark': 'p8rux6nrln',
  'Solarized Light': '24uiv3vfcqj',
};

/** `themes/Paper Light.css` -> `Paper Light`; null for `user.css` and other names. */
export function legacyProfileName(file: string): string | null {
  const m = /^themes\/(.+)\.css$/.exec(file);
  if (m?.[1] === undefined || !isLegacyProfileName(m[1])) return null;
  return m[1];
}

/** `High Contrast Dark` -> `high-contrast-dark` (a DevStyle id). */
export function legacyNameToId(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return id === '' ? 'profile' : id;
}

/** `/* devtex: appearance=dark *\/` in a 1.0.5–1.0.6 profile. */
export function legacyAppearance(css: string): Appearance | null {
  const m = /\/\*\s*devtex:\s*appearance\s*=\s*(light|dark)\s*\*\//i.exec(css);
  return m?.[1] === undefined ? null : (m[1].toLowerCase() as Appearance);
}

const MIGRATED_BLOCK_RE =
  /\s*\/\* Migrated from settings\.jsonc \(colors \/ editor fonts\) when DevTex 1\.0\.5 first ran\. \*\/\s*:root\s*\{([^}]*)\}\s*$/;

/** Split off the block DevTex 1.0.5 appended when it moved settings.jsonc values into a profile. */
export function splitMigratedBlock(css: string): { base: string; vars: Map<string, string> } {
  const m = MIGRATED_BLOCK_RE.exec(css);
  if (m?.[1] === undefined) return { base: css, vars: new Map() };
  const vars = new Map<string, string>();
  for (const d of m[1].matchAll(/(--dt-[\w-]+)\s*:\s*([^;]+);/g))
    if (d[1] !== undefined && d[2] !== undefined) vars.set(d[1], d[2].trim());
  return { base: `${css.slice(0, m.index).replace(/\s*$/, '')}\n`, vars };
}

/**
 * True when a 1.0.5–1.0.6 profile is exactly what DevTex shipped, apart from a
 * migrated block whose values are DevTex's old defaults or the profile's own.
 */
export function isUntouchedLegacyProfile(name: string, css: string): boolean {
  const expected = LEGACY_BUILTIN_HASHES[name];
  if (expected === undefined) return false;
  const { base, vars } = splitMigratedBlock(css);
  if (hashString(base) !== expected && hashString(css) !== expected) return false;
  const own = new Map<string, string>();
  for (const d of base.matchAll(/(--dt-[\w-]+)\s*:\s*([^;]+);/g))
    if (d[1] !== undefined && d[2] !== undefined) own.set(d[1], d[2].trim());
  for (const [k, val] of vars) {
    const mine = own.get(k);
    const def = LEGACY_SETTING_DEFAULTS[k];
    if (
      !(mine !== undefined && sameCssValue(val, mine)) &&
      !(def !== undefined && sameCssValue(val, def))
    )
      return false;
  }
  return true;
}

/** For each DevStyle token, the `--dt-*` variable whose value it takes when a profile is converted. */
const PRIMARY_FOR_DS: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  // first in this list wins for tokens two variables share (fg, bg, mono-font)
  const order = ['--dt-fg', '--dt-bg', '--dt-editor-font'];
  for (const name of order) {
    const x = STYLE_VARIABLES.find((s) => s.name === name);
    if (x?.ds != null) m.set(x.ds, x.name);
  }
  for (const x of STYLE_VARIABLES) if (x.ds !== null && !m.has(x.ds)) m.set(x.ds, x.name);
  return m;
})();

/**
 * A 1.0.5–1.0.6 DevTex profile as a DevStyle profile: a DevStyle header, and
 * each `--dt-*` declaration renamed to its `--ds-*` token. Declarations with
 * no token of their own (e.g. `--dt-preview-math`, or `--dt-preview-bg`, which
 * shares `--ds-bg`) and any other CSS are kept as they are: DevTex still
 * applies them, other apps ignore them.
 */
export function convertLegacyProfile(
  css: string,
  meta: { name: string; appearance: Appearance; pair: string },
  /** Token -> value to fill in first (the matching DevStyle built-in), so the result is complete. */
  base: Readonly<Record<string, string>> = {},
): string {
  const primary = new Set<string>(PRIMARY_FOR_DS.values());
  const dsOf = new Map<string, string | null>(STYLE_VARIABLES.map((x) => [x.name, x.ds]));
  const body = css
    .replace(/\/\*\s*devtex:\s*appearance\s*=\s*(light|dark)\s*\*\/\s*/i, '')
    .replace(/(--dt-[a-z0-9-]+)(\s*:)/g, (all, name: string, colon: string) => {
      const ds = dsOf.get(name);
      return ds != null && primary.has(name) ? `--ds-${ds}${colon}` : all;
    });
  const safeName = meta.name.replace(/["*/]/g, '');
  const set = new Set([...body.matchAll(/--ds-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const filled = Object.entries(base)
    .filter(([token, value]) => !set.has(token) && isSafeCssValue(value))
    .map(([token, value]) => `  --ds-${token}: ${value};`);
  return `/* devstyle: name="${safeName}" appearance=${meta.appearance} pair=${meta.pair} */\n/* Converted from a DevTex style profile by DevTex 1.0.7. The first block is filled in from DevStyle's built-in profile; the rest is the DevTex profile. */\n:root {\n  color-scheme: ${meta.appearance};\n${filled.join('\n')}${filled.length > 0 ? '\n' : ''}}\n\n${body.replace(/^\s+/, '')}`;
}

/** One legacy profile file found in DevTex's themes/ folder. */
export interface LegacyProfileFile {
  file: string;
  name: string;
  css: string;
}

export interface LegacyMigrationPlan {
  /** Files in DevTex's themes/ to delete (untouched copies, and converted ones once written). */
  deletes: string[];
  /** New DevStyle profiles to write (skipped by the caller when the id already exists). */
  writes: { id: string; css: string; from: string }[];
  /** Old profile name -> DevStyle id, for `ui.theme` / `ui.themeDark`. */
  ids: Map<string, string>;
}

const COUNTERPART: Readonly<Record<string, string>> = { Light: 'Dark', Dark: 'Light' };

/**
 * Plan the move from DevTex's own profiles to DevStyle. Untouched copies of a
 * shipped profile are deleted (the DevStyle built-in with the same name takes
 * over). Edited or user-made profiles become DevStyle profiles named
 * `<id>-devtex`, paired with their Light/Dark counterpart when there is one.
 */
export function planLegacyMigration(
  files: readonly LegacyProfileFile[],
  /** DevStyle built-in id -> its token values, used to complete converted profiles. */
  builtins: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): LegacyMigrationPlan {
  const deletes: string[] = [];
  const writes: LegacyMigrationPlan['writes'] = [];
  const ids = new Map<string, string>();
  const edited = new Map<string, LegacyProfileFile>();
  for (const f of files) {
    if (isUntouchedLegacyProfile(f.name, f.css)) {
      deletes.push(f.file);
      ids.set(f.name, legacyNameToId(f.name));
    } else edited.set(f.name, f);
  }
  const newId = (name: string): string => `${legacyNameToId(name)}-devtex`;
  for (const f of edited.values()) {
    const id = newId(f.name);
    ids.set(f.name, id);
    const m = /^(.*)\s(Light|Dark)$/.exec(f.name);
    const appearance = legacyAppearance(f.css) ?? (m?.[2] === 'Dark' ? 'dark' : 'light');
    let pair = appearance === 'dark' ? DEFAULT_PROFILES.light : DEFAULT_PROFILES.dark;
    if (m?.[1] !== undefined && m[2] !== undefined) {
      const other = `${m[1]} ${COUNTERPART[m[2]] ?? ''}`;
      if (edited.has(other)) pair = newId(other);
      else if (other in LEGACY_BUILTIN_HASHES) pair = legacyNameToId(other);
    }
    const base = builtins[legacyNameToId(f.name)] ?? builtins[DEFAULT_PROFILES[appearance]] ?? {};
    writes.push({
      id,
      css: convertLegacyProfile(f.css, { name: `${f.name} (DevTex)`, appearance, pair }, base),
      from: f.file,
    });
    deletes.push(f.file);
  }
  return { deletes, writes, ids };
}

/** `ui.theme` / `ui.themeDark` after the migration: ids stay, old names map through the plan. */
export function migrateProfileSetting(
  value: string,
  ids: ReadonlyMap<string, string>,
  slot: ProfileSlot,
): string {
  if (isProfileId(value)) return value;
  const mapped = ids.get(value);
  if (mapped !== undefined) return mapped;
  if (value in LEGACY_BUILTIN_HASHES) return legacyNameToId(value);
  return DEFAULT_PROFILES[slot];
}
