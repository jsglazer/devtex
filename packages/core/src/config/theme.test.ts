import { describe, expect, it } from 'vitest';
import { hashString } from '../hash.js';
import {
  activeSlot,
  aliasStylesheet,
  changedLegacyVars,
  convertLegacyProfile,
  forcedAppearance,
  isLegacyProfileName,
  isProfileId,
  isProfileSetting,
  isSafeCssValue,
  isUntouchedLegacyProfile,
  LEGACY_BUILTIN_HASHES,
  legacyAppearance,
  legacyNameToId,
  legacyProfileName,
  migrateProfileSetting,
  planLegacyMigration,
  profileForSlot,
  readManagedBlock,
  sameCssValue,
  splitMigratedBlock,
  STYLE_VARIABLES,
  wrapInLayer,
  writeManagedBlock,
} from './theme.js';

describe('profile ids and settings', () => {
  it('accepts DevStyle ids only as ids', () => {
    expect(isProfileId('high-contrast-dark')).toBe(true);
    for (const bad of ['', 'Paper Light', '../x', 'a/b', 'x;y', 'a'.repeat(65)])
      expect(isProfileId(bad), bad).toBe(false);
  });
  it('still accepts 1.0.6 names in settings until they are migrated', () => {
    expect(isProfileSetting('Paper Light')).toBe(true);
    expect(isProfileSetting('paper-light')).toBe(true);
    for (const bad of ['../x', '.hidden', 'a..b']) expect(isProfileSetting(bad), bad).toBe(false);
    expect(isLegacyProfileName('user')).toBe(false);
    expect(isLegacyProfileName('High Contrast Dark')).toBe(true);
  });
});

describe('light/dark selection', () => {
  const ui = { theme: 'paper-light', themeDark: 'solarized-dark' };
  it('follows the system appearance', () => {
    expect(profileForSlot(ui, activeSlot(false))).toBe('paper-light');
    expect(profileForSlot(ui, activeSlot(true))).toBe('solarized-dark');
  });
  it('falls back to Default for an invalid or not-yet-migrated value', () => {
    expect(profileForSlot({ theme: '../x', themeDark: 'Paper Dark' }, 'light')).toBe(
      'default-light',
    );
    expect(profileForSlot({ theme: '../x', themeDark: 'Paper Dark' }, 'dark')).toBe('default-dark');
  });
  it('forces the native appearance only when the profile disagrees with the system', () => {
    expect(forcedAppearance('dark', true)).toBeNull();
    expect(forcedAppearance('dark', false)).toBe('dark');
    expect(forcedAppearance(null, false)).toBeNull();
  });
});

describe('aliases', () => {
  it('maps each --dt-* to its --ds-* token, and DevTex-only ones to their own value', () => {
    const css = aliasStylesheet();
    expect(css).toContain('--dt-bg: var(--ds-bg);');
    expect(css).toContain('--dt-editor-env-pair: var(--ds-pair-highlight);');
    expect(css).toContain('--dt-syntax-command: var(--ds-syn-keyword);');
    expect(css).toContain('--dt-pdf-filter: var(--ds-page-filter);');
    expect(css).toContain('--dt-preview-math: currentColor;');
    expect(css.startsWith(':root {')).toBe(true);
  });
});

describe('CSS helpers', () => {
  it('wraps a profile in a cascade layer and drops @import/@charset', () => {
    const out = wrapInLayer(
      '@charset "utf-8";\n@import url(x.css);\n:root { --dt-bg: #fff; }',
      'profile',
    );
    expect(out).toBe('@layer profile {\n:root { --dt-bg: #fff; }\n}\n');
  });
  it('accepts plain values and rejects anything that could break out of a declaration', () => {
    expect(isSafeCssValue('rgba(1, 2, 3, 0.5)')).toBe(true);
    expect(isSafeCssValue("'Fira Code', monospace")).toBe(true);
    for (const bad of ['red; } body { x', 'a{', '</style>', '/* x', ''])
      expect(isSafeCssValue(bad), bad).toBe(false);
  });
  it('managed block round-trips and keeps the user’s own CSS', () => {
    const mine = '/* mine */\n.cm-line { letter-spacing: 1px; }\n';
    const a = writeManagedBlock(mine, new Map([['--dt-editor-size', '15px']]));
    expect(a.startsWith(mine.trimEnd())).toBe(true);
    expect(readManagedBlock(a)).toEqual(new Map([['--dt-editor-size', '15px']]));
    const b = writeManagedBlock(
      a,
      new Map([
        ['--dt-editor-size', '16px'],
        ['--dt-editor-font', 'Menlo'],
      ]),
    );
    expect(b.match(/devtex:managed:begin/g)).toHaveLength(1);
    expect(b).toContain('.cm-line { letter-spacing: 1px; }');
    expect(readManagedBlock(b).get('--dt-editor-size')).toBe('16px');
    expect(readManagedBlock(writeManagedBlock(b, new Map())).size).toBe(0);
    expect(readManagedBlock(null).size).toBe(0);
  });
  it('managed block drops unsafe values and non-variables', () => {
    const t = writeManagedBlock(
      null,
      new Map([
        ['--dt-bg', 'red;}*{color:red'],
        ['color', 'red'],
      ]),
    );
    expect(readManagedBlock(t).size).toBe(0);
    expect(t).not.toContain('color:red');
  });
  it('compares CSS values loosely', () => {
    expect(sameCssValue('rgba(120, 120, 180, 0.10)', 'rgba(120,120,180,0.1)')).toBe(true);
    expect(sameCssValue("'SF Mono', Menlo, monospace", 'SF Mono, Menlo, monospace')).toBe(true);
    expect(sameCssValue('14px', '15px')).toBe(false);
  });
});

describe('migration from settings.jsonc (1.0.4)', () => {
  it('keeps only the values the user changed from the old defaults', () => {
    const vars = new Map([
      ['--dt-editor-size', '14px'],
      ['--dt-editor-active-line', 'rgba(120,120,180,0.1)'],
      ['--dt-editor-font', 'Fira Code'],
    ]);
    expect(changedLegacyVars(vars)).toEqual(new Map([['--dt-editor-font', 'Fira Code']]));
  });
});

describe('migration from DevTex 1.0.5–1.0.6 profiles', () => {
  const shipped = ':root {\n  --dt-bg: #fff;\n  --dt-editor-active-line: rgba(1, 2, 3, 0.1);\n}\n';
  const name = 'Default Light';
  const withHash = (css: string): void => {
    (LEGACY_BUILTIN_HASHES as Record<string, string>)[name] = hashString(css);
  };
  it('reads old file names, appearance headers and ids', () => {
    expect(legacyProfileName('themes/Paper Light.css')).toBe('Paper Light');
    expect(legacyProfileName('themes/user.css')).toBeNull();
    expect(legacyProfileName('syntax/x.json')).toBeNull();
    expect(legacyNameToId('High Contrast Dark')).toBe('high-contrast-dark');
    expect(legacyNameToId('My  Theme!')).toBe('my-theme');
    expect(legacyNameToId('!!!')).toBe('profile');
    expect(legacyAppearance('/*devtex:appearance = Dark*/')).toBe('dark');
    expect(legacyAppearance(':root{}')).toBeNull();
  });
  it('splits off the block 1.0.5 appended', () => {
    const block =
      '\n/* Migrated from settings.jsonc (colors / editor fonts) when DevTex 1.0.5 first ran. */\n:root {\n  --dt-editor-size: 14px;\n}\n';
    const r = splitMigratedBlock(shipped + block);
    expect(r.base).toBe(shipped);
    expect(r.vars).toEqual(new Map([['--dt-editor-size', '14px']]));
    expect(splitMigratedBlock(shipped).vars.size).toBe(0);
  });
  it('treats a shipped copy as untouched, even with a migrated block at old defaults', () => {
    const original = { ...LEGACY_BUILTIN_HASHES };
    try {
      withHash(shipped);
      expect(isUntouchedLegacyProfile(name, shipped)).toBe(true);
      const atDefaults = `${shipped}\n/* Migrated from settings.jsonc (colors / editor fonts) when DevTex 1.0.5 first ran. */\n:root {\n  --dt-editor-active-line: rgba(120, 120, 180, 0.10);\n  --dt-bg: #FFF;\n}\n`;
      expect(isUntouchedLegacyProfile(name, atDefaults)).toBe(true);
      const changed = atDefaults.replace('#FFF', '#000');
      expect(isUntouchedLegacyProfile(name, changed)).toBe(false);
      expect(isUntouchedLegacyProfile(name, `${shipped}.x{}`)).toBe(false);
      expect(isUntouchedLegacyProfile('Mine', shipped)).toBe(false);
    } finally {
      Object.assign(LEGACY_BUILTIN_HASHES, original);
    }
  });
  it('converts a profile: DevStyle header, --ds-* names, the rest kept, gaps filled', () => {
    const out = convertLegacyProfile(
      '/* devtex: appearance=dark */\n:root { --dt-bg: #111; --dt-preview-bg: #222; --dt-editor-font: Menlo; --dt-mono-font: Monaco; --dt-preview-math: teal; }\n.x { color: red; }',
      { name: 'Mine "Dark"', appearance: 'dark', pair: 'mine-light' },
      { bg: '#000', accent: '#abc', 'bad-one': 'x;y' },
    );
    expect(out.split('\n')[0]).toBe(
      '/* devstyle: name="Mine Dark" appearance=dark pair=mine-light */',
    );
    expect(out).not.toContain('devtex: appearance');
    expect(out).toContain('--ds-bg: #111;');
    expect(out).toContain('--dt-preview-bg: #222;');
    expect(out).toContain('--ds-mono-font: Menlo;');
    expect(out).toContain('--dt-mono-font: Monaco;');
    expect(out).toContain('--dt-preview-math: teal;');
    expect(out).toContain('.x { color: red; }');
    expect(out).toContain('--ds-accent: #abc;');
    expect(out).not.toContain('--ds-bg: #000');
    expect(out).not.toContain('bad-one');
    expect(out).toContain('color-scheme: dark;');
  });
  it('plans: untouched copies deleted, edited ones converted and paired', () => {
    const original = { ...LEGACY_BUILTIN_HASHES };
    try {
      withHash(shipped);
      const plan = planLegacyMigration([
        { file: 'themes/Default Light.css', name, css: shipped },
        { file: 'themes/Paper Dark.css', name: 'Paper Dark', css: ':root { --dt-bg: #000; }' },
        { file: 'themes/Mine Light.css', name: 'Mine Light', css: ':root{}' },
        { file: 'themes/Mine Dark.css', name: 'Mine Dark', css: ':root{}' },
      ]);
      expect(plan.deletes).toContain('themes/Default Light.css');
      expect(plan.ids.get(name)).toBe('default-light');
      expect(plan.ids.get('Paper Dark')).toBe('paper-dark-devtex');
      const paper = plan.writes.find((w) => w.id === 'paper-dark-devtex');
      expect(paper?.css).toContain('appearance=dark pair=paper-light');
      expect(plan.writes.find((w) => w.id === 'mine-light-devtex')?.css).toContain(
        'pair=mine-dark-devtex',
      );
      expect(plan.writes.find((w) => w.id === 'mine-dark-devtex')?.css).toContain(
        'appearance=dark pair=mine-light-devtex',
      );
    } finally {
      Object.assign(LEGACY_BUILTIN_HASHES, original);
    }
  });
  it('maps settings through the plan, then by name, then to Default', () => {
    const ids = new Map([['Mine', 'mine-devtex']]);
    expect(migrateProfileSetting('paper-light', ids, 'light')).toBe('paper-light');
    expect(migrateProfileSetting('Mine', ids, 'light')).toBe('mine-devtex');
    expect(migrateProfileSetting('Solarized Dark', ids, 'dark')).toBe('solarized-dark');
    expect(migrateProfileSetting('Gone', ids, 'dark')).toBe('default-dark');
  });
});

describe('documented variables', () => {
  it('covers the four required groups with unique names', () => {
    const names = STYLE_VARIABLES.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of [
      '--dt-bg',
      '--dt-fg',
      '--dt-muted',
      '--dt-border',
      '--dt-panel',
      '--dt-accent',
      '--dt-error',
      '--dt-warning',
      '--dt-success',
      '--dt-sync',
      '--dt-shadow',
      '--dt-font',
      '--dt-font-size',
      '--dt-editor-font',
      '--dt-editor-size',
      '--dt-editor-line-height',
      '--dt-editor-bg',
      '--dt-editor-fg',
      '--dt-editor-gutter',
      '--dt-editor-cursor',
      '--dt-editor-selection',
      '--dt-editor-active-line',
      '--dt-editor-matching-bracket',
      '--dt-editor-selection-match',
      '--dt-editor-broken',
      '--dt-editor-env-pair',
      '--dt-syntax-command',
      '--dt-preview-font',
      '--dt-preview-size',
      '--dt-preview-line-height',
      '--dt-preview-heading-font',
      '--dt-preview-fg',
      '--dt-preview-bg',
      '--dt-preview-link',
      '--dt-pdf-filter',
      '--dt-editor-gutter-fg',
      '--dt-editor-search-match',
      '--dt-dialog-shadow',
    ])
      expect(names, n).toContain(n);
  });
});
