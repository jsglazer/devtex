import { describe, expect, it } from 'vitest';
import {
  loadSettings,
  parseCssColor,
  profileAppearance,
  readManagedBlock,
  STYLE_VARIABLES,
  type Appearance,
} from '@devtex/core';
import { BUILTIN_FAMILIES, BUILTIN_PROFILES } from '../themes/index.js';
import { layeredRule } from './cm-layer.js';
import { EDITOR_THEME_SPEC } from './editor.js';
import { OpenFiles } from './open-files.js';
import { isLinkClick } from './preview.js';
import { ProfileManager, type ConfigStore, type StyleSink } from './profiles.js';
import { COLOR_VARIABLES, nextOverrides } from './settings-ui.js';

class MemoryConfig implements ConfigStore {
  readonly files = new Map<string, string>();
  writes: string[] = [];
  failRead = new Set<string>();
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.files.set(k, v);
  }
  readConfig(name: string): Promise<string | null> {
    if (this.failRead.has(name)) return Promise.reject(new Error('permission denied'));
    return Promise.resolve(this.files.get(name) ?? null);
  }
  writeConfig(name: string, content: string): Promise<void> {
    this.writes.push(name);
    this.files.set(name, content);
    return Promise.resolve();
  }
  listThemeFiles(): Promise<string[]> {
    return Promise.resolve([...this.files.keys()].filter((k) => k.startsWith('themes/')).sort());
  }
}

class RecordingSink implements StyleSink {
  profile = '';
  user = '';
  appearance: { own: Appearance | null; forced: Appearance | null } | null = null;
  setProfile(css: string): void {
    this.profile = css;
  }
  setUser(css: string): void {
    this.user = css;
  }
  setAppearance(own: Appearance | null, forced: Appearance | null): void {
    this.appearance = { own, forced };
  }
}

const ui = (theme: string, themeDark: string): { theme: string; themeDark: string } => ({
  theme,
  themeDark,
});

describe('built-in profiles', () => {
  it('ship Default, Paper, High Contrast and Solarized as Light/Dark pairs', () => {
    for (const family of Object.values(BUILTIN_FAMILIES))
      for (const v of ['Light', 'Dark'])
        expect(BUILTIN_PROFILES[`${family} ${v}`], `${family} ${v}`).toBeDefined();
    expect(Object.keys(BUILTIN_PROFILES)).toHaveLength(8);
  });
  it('declare an appearance header matching their name and set every documented variable', () => {
    for (const [name, css] of Object.entries(BUILTIN_PROFILES)) {
      expect(profileAppearance(css), name).toBe(name.endsWith('Dark') ? 'dark' : 'light');
      for (const v of STYLE_VARIABLES) expect(css, `${name} ${v.name}`).toContain(`${v.name}:`);
    }
  });
  it('highlight colours are parseable by the Settings colour picker', () => {
    for (const [name, css] of Object.entries(BUILTIN_PROFILES))
      for (const v of Object.keys(COLOR_VARIABLES)) {
        const m = new RegExp(`${v}:\\s*([^;]+);`).exec(css);
        expect(parseCssColor(m?.[1] ?? ''), `${name} ${v}`).not.toBeNull();
      }
  });
  it('the PDF filter is empty (none) in the light profiles', () => {
    for (const [name, css] of Object.entries(BUILTIN_PROFILES))
      if (name.endsWith('Light')) expect(css, name).toContain('--dt-pdf-filter: none;');
  });
});

describe('ProfileManager', () => {
  it('copies a built-in into themes/ on first use and never overwrites an edited file', async () => {
    const store = new MemoryConfig();
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, sink, BUILTIN_PROFILES);
    await pm.apply(ui('Paper Light', 'Paper Dark'), false);
    expect(store.files.get('themes/Paper Light.css')).toBe(BUILTIN_PROFILES['Paper Light']);
    expect(sink.profile.endsWith(BUILTIN_PROFILES['Paper Light'] ?? 'x')).toBe(true);
    store.files.set('themes/Paper Light.css', '/* mine */ :root { --dt-bg: red; }');
    store.writes = [];
    await pm.apply(ui('Paper Light', 'Paper Dark'), false);
    expect(store.writes).toEqual([]);
    expect(sink.profile).toContain('--dt-bg: red');
  });
  it('follows the system appearance: light slot vs dark slot', async () => {
    const store = new MemoryConfig();
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, sink, BUILTIN_PROFILES);
    expect((await pm.apply(ui('Paper Light', 'Solarized Dark'), true)).name).toBe('Solarized Dark');
    expect(sink.appearance).toEqual({ own: 'dark', forced: null });
    expect((await pm.apply(ui('Paper Light', 'Solarized Dark'), false)).name).toBe('Paper Light');
    expect(sink.appearance).toEqual({ own: 'light', forced: null });
  });
  it('forces the window appearance when a profile disagrees with the system', async () => {
    const sink = new RecordingSink();
    const pm = new ProfileManager(new MemoryConfig(), sink, BUILTIN_PROFILES);
    await pm.apply(ui('Solarized Dark', 'Default Dark'), false);
    expect(sink.appearance).toEqual({ own: 'dark', forced: 'dark' });
  });
  it('falls back to Default and reports a missing profile', async () => {
    const sink = new RecordingSink();
    const pm = new ProfileManager(new MemoryConfig(), sink, BUILTIN_PROFILES);
    const p = await pm.apply(ui('Nope Light', 'Default Dark'), false);
    expect(p.name).toBe('Default Light');
    expect(sink.profile).toBe(BUILTIN_PROFILES['Default Light']);
    expect(pm.problems).toEqual([
      'themes/Nope Light.css: style profile "Nope Light" not found (using Default Light)',
    ]);
  });
  it('falls back to Default and reports an unreadable profile', async () => {
    const store = new MemoryConfig({ 'themes/Mine.css': ':root{}' });
    store.failRead.add('themes/Mine.css');
    const pm = new ProfileManager(store, new RecordingSink(), BUILTIN_PROFILES);
    const p = await pm.apply(ui('Default Light', 'Mine'), true);
    expect(p.name).toBe('Default Dark');
    expect(pm.problems[0]).toMatch(/^themes\/Mine\.css: could not be read \(permission denied\)/);
  });
  it('a minimal profile sits on top of the slot’s Default, so unset variables keep a value', async () => {
    const store = new MemoryConfig({ 'themes/Tiny.css': ':root { --dt-accent: teal; }' });
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, sink, BUILTIN_PROFILES);
    await pm.apply(ui('Default Light', 'Tiny'), true);
    expect(sink.profile.startsWith(BUILTIN_PROFILES['Default Dark'] ?? 'x')).toBe(true);
    expect(sink.profile.indexOf('teal')).toBeGreaterThan(
      sink.profile.indexOf('--dt-accent: #8f9bff'),
    );
  });
  it('a custom profile without a built-in loads from themes/', async () => {
    const store = new MemoryConfig({ 'themes/Mine.css': ':root { --dt-accent: teal; }' });
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, sink, BUILTIN_PROFILES);
    await pm.apply(ui('Mine', 'Default Dark'), false);
    expect(sink.profile).toContain('teal');
    expect(sink.appearance).toEqual({ own: null, forced: null });
    expect(await pm.available()).toContain('Mine');
    expect(await pm.available()).toContain('High Contrast Dark');
  });
  it('applies user.css on top and only reports changes that affect the active profile', async () => {
    const store = new MemoryConfig({ 'themes/user.css': ':root { --dt-bg: pink; }' });
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, sink, BUILTIN_PROFILES);
    await pm.apply(ui('Default Light', 'Default Dark'), false);
    expect(sink.user).toContain('pink');
    expect(pm.affects(['themes/Default Light.css'])).toBe(true);
    expect(pm.affects(['themes/user.css'])).toBe(true);
    expect(pm.affects(['themes/Paper Light.css'])).toBe(false);
  });
  it('the Settings overrides go into the managed block of user.css, never into a profile', async () => {
    const store = new MemoryConfig({ 'themes/user.css': '.cm-line { letter-spacing: 1px; }\n' });
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, sink, BUILTIN_PROFILES);
    await pm.apply(ui('Default Light', 'Default Dark'), false);
    store.writes = [];
    await pm.saveOverrides(new Map([['--dt-editor-size', '16px']]));
    expect(store.writes).toEqual(['themes/user.css']);
    const user = store.files.get('themes/user.css') ?? '';
    expect(user).toContain('.cm-line { letter-spacing: 1px; }');
    expect(readManagedBlock(user).get('--dt-editor-size')).toBe('16px');
    expect(sink.user).toBe(user);
    expect(await pm.overrides()).toEqual(new Map([['--dt-editor-size', '16px']]));
  });
});

describe('migration from settings.jsonc', () => {
  const old =
    '{ "editor": { "fontFamily": "Fira Code", "fontSize": 16, "lineHeight": 1.4, "lineWrapping": true }, "colors": { "currentLine": "#223344", "matchingBracket": "rgba(1, 2, 3, 0.5)" } }';
  it('writes the old values into Default Light and Default Dark', async () => {
    const legacy = loadSettings(old).legacy;
    const store = new MemoryConfig();
    const pm = new ProfileManager(store, new RecordingSink(), BUILTIN_PROFILES);
    const written = await pm.migrate(legacy);
    expect(written).toEqual(['themes/Default Light.css', 'themes/Default Dark.css']);
    for (const f of written) {
      const css = store.files.get(f) ?? '';
      expect(css.startsWith(BUILTIN_PROFILES[f.slice(7, -4)]?.trimEnd() ?? 'x')).toBe(true);
      expect(css).toContain('--dt-editor-font: Fira Code;');
      expect(css).toContain('--dt-editor-size: 16px;');
      expect(css).toContain('--dt-editor-active-line: #223344;');
      expect(css).toContain('--dt-editor-matching-bracket: rgba(1, 2, 3, 0.5);');
    }
    expect(pm.notes[0]).toMatch(
      /^settings\.jsonc: editor\.fontFamily, .* moved to themes\/Default Light\.css and themes\/Default Dark\.css/,
    );
  });
  it('the migrated values win over the profile and show up after apply', async () => {
    const store = new MemoryConfig();
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, sink, BUILTIN_PROFILES);
    await pm.migrate(loadSettings(old).legacy);
    await pm.apply(ui('Default Light', 'Default Dark'), false);
    expect(sink.profile.lastIndexOf('--dt-editor-size: 16px')).toBeGreaterThan(
      sink.profile.indexOf('--dt-editor-size: 14px'),
    );
  });
  it('never overwrites a Default profile that already exists', async () => {
    const store = new MemoryConfig({ 'themes/Default Light.css': '/* mine */' });
    const pm = new ProfileManager(store, new RecordingSink(), BUILTIN_PROFILES);
    expect(await pm.migrate(loadSettings(old).legacy)).toEqual(['themes/Default Dark.css']);
    expect(store.files.get('themes/Default Light.css')).toBe('/* mine */');
    expect(pm.notes[0]).toContain('already existed and was left unchanged');
  });
  it('nothing to migrate without the old keys', async () => {
    const store = new MemoryConfig();
    const pm = new ProfileManager(store, new RecordingSink(), BUILTIN_PROFILES);
    expect(await pm.migrate(loadSettings('{ "ui": { "zoom": 1 } }').legacy)).toEqual([]);
    expect(store.writes).toEqual([]);
  });
});

describe('editor theme', () => {
  it('uses only style-profile variables (no literal colours or fonts)', () => {
    for (const [sel, style] of Object.entries(EDITOR_THEME_SPEC))
      for (const [prop, value] of Object.entries(style)) {
        if (prop === 'height') continue;
        expect(value, `${sel} ${prop}`).toMatch(/var\(--dt-[\w-]+\)/);
        expect(value, `${sel} ${prop}`).not.toMatch(/#[0-9a-f]{3}|rgb/i);
      }
  });
  it("CodeMirror's injected rules go into the lowest cascade layer", () => {
    expect(layeredRule('.ͼ1 .cm-activeLine { color: red }')).toBe(
      '@layer cm { .ͼ1 .cm-activeLine { color: red } }',
    );
    expect(layeredRule('@layer x;')).toBe('@layer x;');
  });
});

describe('Settings dialog overrides', () => {
  const before = new Map([['--dt-editor-font', 'Menlo']]);
  it('changed fields become overrides, untouched fields keep theirs, cleared fields drop', () => {
    expect(
      nextOverrides(before, [
        { variable: '--dt-editor-font', initial: 'Menlo', value: 'Menlo' },
        { variable: '--dt-editor-size', initial: '14px', value: '16px' },
      ]),
    ).toEqual(
      new Map([
        ['--dt-editor-font', 'Menlo'],
        ['--dt-editor-size', '16px'],
      ]),
    );
    expect(
      nextOverrides(before, [{ variable: '--dt-editor-font', initial: 'Menlo', value: '' }]).size,
    ).toBe(0);
  });
  it('an unchanged field adds no override (so switching profiles still changes it)', () => {
    expect(
      nextOverrides(new Map(), [
        { variable: '--dt-editor-active-line', initial: '#abc', value: ' #abc ' },
      ]).size,
    ).toBe(0);
  });
});

describe('open-file tabs', () => {
  it('opens files individually and closes to a neighbour', () => {
    const t = new OpenFiles();
    t.add('main.tex');
    t.add('ch/one.tex');
    t.add('main.tex');
    t.add('refs.bib');
    expect(t.list).toEqual(['main.tex', 'ch/one.tex', 'refs.bib']);
    expect(t.close('ch/one.tex', 'ch/one.tex')).toBe('refs.bib');
    expect(t.close('refs.bib', 'refs.bib')).toBe('main.tex');
    expect(t.close('x.tex', 'main.tex')).toBe('main.tex');
    expect(t.close('main.tex', 'other.tex')).toBe('other.tex');
    expect(t.list).toEqual([]);
    t.add('a.tex');
    expect(t.close('a.tex', 'a.tex')).toBe('');
  });
  it('drops tabs whose files are gone', () => {
    const t = new OpenFiles();
    t.add('a.tex');
    t.add('b.tex');
    t.retain((f) => f !== 'a.tex');
    expect(t.list).toEqual(['b.tex']);
  });
});

describe('preview links (audit 20261123)', () => {
  it('recognises clicks on or inside HTML and SVG anchors', () => {
    const inside = { closest: (sel: string) => (sel === 'a' ? {} : null) };
    const outside = { closest: () => null };
    expect(isLinkClick(inside as unknown as EventTarget)).toBe(true);
    expect(isLinkClick(outside as unknown as EventTarget)).toBe(false);
    expect(isLinkClick(null)).toBe(false);
    expect(isLinkClick({} as EventTarget)).toBe(false);
  });
});
