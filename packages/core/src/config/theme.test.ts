import { describe, expect, it } from 'vitest';
import {
  activeSlot,
  appendMigrated,
  familyOf,
  forcedAppearance,
  isSafeCssValue,
  isValidProfileName,
  profileAppearance,
  profileFile,
  profileForSlot,
  profileNameOf,
  profileNames,
  readManagedBlock,
  STYLE_VARIABLES,
  wrapInLayer,
  writeManagedBlock,
} from './theme.js';

describe('style profile names and files', () => {
  it('maps names to themes/<name>.css and back', () => {
    expect(profileFile('Paper Light')).toBe('themes/Paper Light.css');
    expect(profileNameOf('themes/Paper Light.css')).toBe('Paper Light');
    expect(profileNameOf('themes/user.css')).toBeNull();
    expect(profileNameOf('syntax/x.json')).toBeNull();
    expect(profileNameOf('themes/../x.css')).toBeNull();
  });
  it('rejects unsafe names', () => {
    for (const bad of ['', '../x', 'a/b', '.hidden', 'user', 'x;y', 'a..b'])
      expect(isValidProfileName(bad), bad).toBe(false);
    expect(isValidProfileName('High Contrast Dark')).toBe(true);
  });
  it('lists profiles from a theme listing, sorted, without user.css', () => {
    expect(
      profileNames(['themes/user.css', 'themes/Paper Light.css', 'themes/Default Dark.css']),
    ).toEqual(['Default Dark', 'Paper Light']);
  });
  it('families pair Light and Dark', () => {
    expect(familyOf('High Contrast Dark')).toBe('High Contrast');
    expect(familyOf('Mine')).toBe('Mine');
  });
});

describe('light/dark selection', () => {
  const ui = { theme: 'Paper Light', themeDark: 'Solarized Dark' };
  it('follows the system appearance', () => {
    expect(profileForSlot(ui, activeSlot(false))).toBe('Paper Light');
    expect(profileForSlot(ui, activeSlot(true))).toBe('Solarized Dark');
  });
  it('falls back to Default for an invalid name', () => {
    expect(profileForSlot({ theme: '../x', themeDark: '' }, 'light')).toBe('Default Light');
    expect(profileForSlot({ theme: '../x', themeDark: '' }, 'dark')).toBe('Default Dark');
  });
  it('reads the appearance header', () => {
    expect(profileAppearance('/* devtex: appearance=dark */\n:root{}')).toBe('dark');
    expect(profileAppearance('/*devtex:appearance = Light*/')).toBe('light');
    expect(profileAppearance(':root{}')).toBeNull();
  });
  it('forces the native appearance only when the profile disagrees with the system', () => {
    const dark = '/* devtex: appearance=dark */';
    expect(forcedAppearance(dark, true)).toBeNull();
    expect(forcedAppearance(dark, false)).toBe('dark');
    expect(forcedAppearance(':root{}', false)).toBeNull();
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
  it('migrated values are appended after the profile so they win', () => {
    const out = appendMigrated(
      ':root { --dt-editor-size: 14px; }',
      new Map([['--dt-editor-size', '16px']]),
    );
    expect(out.indexOf('16px')).toBeGreaterThan(out.indexOf('14px'));
    expect(appendMigrated('x', new Map())).toBe('x');
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
    ])
      expect(names, n).toContain(n);
  });
});
