import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES,
  CONFIG_FILE,
  LAYERS,
  memoryHost,
  parseHeader,
  TOKENS,
  type FolderHost,
  type ProfileInfo,
} from '@devstyle/web';
import {
  aliasStylesheet,
  DEVTEX_LAYERS,
  loadSettings,
  parseCssColor,
  readManagedBlock,
  STYLE_VARIABLES,
  type Appearance,
} from '@devtex/core';
import { BUILTIN_FAMILIES } from '../themes/index.js';
import { layeredRule } from './cm-layer.js';
import { EDITOR_THEME_SPEC } from './editor.js';
import legacyDefaultDarkMigrated from './fixtures/legacy-Default-Dark-migrated105.css?raw';
import legacyDefaultDark from './fixtures/legacy-Default-Dark.css?raw';
import legacyDefaultLight from './fixtures/legacy-Default-Light.css?raw';
import legacyPaperDark from './fixtures/legacy-Paper-Dark.css?raw';
import { OpenFiles } from './open-files.js';
import { isLinkClick } from './preview.js';
import { ProfileManager, type ConfigStore, type StyleChoice, type StyleSink } from './profiles.js';
import { COLOR_VARIABLES, nextOverrides, profileOptions } from './settings-ui.js';

class MemoryConfig implements ConfigStore {
  readonly files = new Map<string, string>();
  writes: string[] = [];
  deleted: string[] = [];
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
  deleteThemeFile(name: string): Promise<void> {
    this.deleted.push(name);
    this.files.delete(name);
    return Promise.resolve();
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

const own = (theme: string, themeDark: string): StyleChoice => ({
  followSharedStyle: false,
  theme,
  themeDark,
});
const follow: StyleChoice = {
  followSharedStyle: true,
  theme: 'default-light',
  themeDark: 'default-dark',
};

/** A shared folder with the built-ins installed and the given extra files. */
async function sharedFolder(
  extra: Record<string, string> = {},
): Promise<ReturnType<typeof memoryHost>> {
  const host = memoryHost(extra);
  const pm = new ProfileManager(new MemoryConfig(), host, new RecordingSink());
  await pm.install();
  return host;
}

const failingHost: FolderHost = {
  read: () => Promise.reject(new Error('operation not permitted')),
  write: () => Promise.reject(new Error('operation not permitted')),
  list: () => Promise.reject(new Error('operation not permitted')),
};

describe('DevStyle variables', () => {
  const tokens = new Set(TOKENS.map((t) => t.name));
  it('every --dt-* stands for a real DevStyle token or has its own value', () => {
    for (const v of STYLE_VARIABLES) {
      if (v.ds === null) expect(v.fallback, v.name).toBeDefined();
      else expect(tokens.has(v.ds), `${v.name} -> --ds-${v.ds}`).toBe(true);
    }
  });
  it('the alias sheet defines every --dt-* once, through var(--ds-*)', () => {
    const css = aliasStylesheet();
    for (const v of STYLE_VARIABLES) {
      const decls = css.match(new RegExp(`${v.name}:`, 'g')) ?? [];
      expect(decls, v.name).toHaveLength(1);
      expect(css).toContain(
        v.ds === null ? `${v.name}: ${v.fallback ?? ''};` : `${v.name}: var(--ds-${v.ds});`,
      );
    }
  });
  it('every built-in DevStyle profile sets every token an alias needs', () => {
    for (const [id, css] of Object.entries(BUILTIN_PROFILES))
      for (const v of STYLE_VARIABLES)
        if (v.ds !== null) expect(css, `${id} --ds-${v.ds}`).toContain(`--ds-${v.ds}:`);
  });
  it("DevTex's layer order is DevStyle's, with CodeMirror's layer below it", () => {
    expect(DEVTEX_LAYERS.slice(1)).toEqual([...LAYERS]);
    expect(DEVTEX_LAYERS[0]).toBe('cm');
  });
  it('the menu families are real DevStyle pairs', () => {
    for (const f of Object.values(BUILTIN_FAMILIES)) {
      expect(parseHeader(BUILTIN_PROFILES[f.light] ?? '')?.pair, f.name).toBe(f.dark);
      expect(parseHeader(BUILTIN_PROFILES[f.dark] ?? '')?.appearance, f.name).toBe('dark');
    }
  });
  it('highlight colours the Settings dialog edits are parseable colours in every built-in', () => {
    for (const [id, css] of Object.entries(BUILTIN_PROFILES))
      for (const variable of Object.keys(COLOR_VARIABLES)) {
        const ds = STYLE_VARIABLES.find((x) => x.name === variable)?.ds ?? 'x';
        const m = new RegExp(`--ds-${ds}:\\s*([^;]+);`).exec(css);
        expect(parseCssColor(m?.[1] ?? ''), `${id} ${variable}`).not.toBeNull();
      }
  });
});

describe('ProfileManager', () => {
  it('installs the built-ins and devstyle.json into the shared folder without overwriting', async () => {
    const host = memoryHost({ 'profiles/paper-light.css': '/* mine */' });
    const pm = new ProfileManager(new MemoryConfig(), host, new RecordingSink());
    const written = await pm.install();
    expect(written).toContain(CONFIG_FILE);
    expect(written).not.toContain('profiles/paper-light.css');
    expect(host.files.get('profiles/paper-light.css')).toBe('/* mine */');
    expect(await pm.install()).toEqual([]);
  });
  it('follows the shared choice, and the system appearance picks light or dark', async () => {
    const host = await sharedFolder();
    const sink = new RecordingSink();
    const pm = new ProfileManager(new MemoryConfig(), host, sink);
    await pm.setShared('paper-light', 'solarized-dark');
    expect((await pm.apply(follow, false)).id).toBe('paper-light');
    expect(sink.appearance).toEqual({ own: 'light', forced: null });
    expect((await pm.apply(follow, true)).id).toBe('solarized-dark');
    expect(sink.appearance).toEqual({ own: 'dark', forced: null });
    expect(pm.problems).toEqual([]);
  });
  it('a change made by another app shows on the next apply', async () => {
    const host = await sharedFolder();
    const pm = new ProfileManager(new MemoryConfig(), host, new RecordingSink());
    expect((await pm.apply(follow, false)).id).toBe('default-light');
    await host.write(
      CONFIG_FILE,
      JSON.stringify({ version: 1, light: 'paper-light', dark: 'paper-dark' }),
    );
    expect((await pm.apply(follow, false)).id).toBe('paper-light');
  });
  it('"Use my own" ignores the shared choice', async () => {
    const host = await sharedFolder();
    const pm = new ProfileManager(new MemoryConfig(), host, new RecordingSink());
    await pm.setShared('paper-light', 'paper-dark');
    expect((await pm.apply(own('solarized-light', 'default-dark'), false)).id).toBe(
      'solarized-light',
    );
    expect(await pm.chosen(own('solarized-light', 'default-dark'), 'light')).toBe(
      'solarized-light',
    );
    expect(await pm.chosen(follow, 'light')).toBe('paper-light');
  });
  it('an edited profile in the folder wins over the built-in copy', async () => {
    const mine =
      '/* devstyle: name="Paper Light" appearance=light pair=paper-dark */\n:root { --ds-accent: #008080; }';
    const host = await sharedFolder({ 'profiles/paper-light.css': mine });
    const sink = new RecordingSink();
    const pm = new ProfileManager(new MemoryConfig(), host, sink);
    await pm.apply(own('paper-light', 'paper-dark'), false);
    expect(sink.profile).toContain('--ds-accent: #008080');
  });
  it('forces the window appearance when a profile disagrees with the system', async () => {
    const sink = new RecordingSink();
    const pm = new ProfileManager(new MemoryConfig(), await sharedFolder(), sink);
    await pm.apply(own('solarized-dark', 'default-dark'), false);
    expect(sink.appearance).toEqual({ own: 'dark', forced: 'dark' });
  });
  it('falls back to Default and reports a missing profile', async () => {
    const sink = new RecordingSink();
    const pm = new ProfileManager(new MemoryConfig(), await sharedFolder(), sink);
    const p = await pm.apply(own('nope-light', 'default-dark'), false);
    expect(p.id).toBe('default-light');
    expect(sink.profile).toBe(BUILTIN_PROFILES['default-light']);
    expect(pm.problems).toEqual([
      'DevStyle profiles/nope-light.css: style profile "nope-light" not found (using default-light)',
    ]);
  });
  it('reports a broken devstyle.json and bad profile values, and still shows a profile', async () => {
    const host = await sharedFolder({
      [CONFIG_FILE]: '{ nope',
      'profiles/mine-dark.css':
        '/* devstyle: name="Mine Dark" appearance=dark pair=mine-light */\n:root { --ds-bg: red; }',
    });
    const pm = new ProfileManager(new MemoryConfig(), host, new RecordingSink());
    expect((await pm.apply(follow, true)).id).toBe('default-dark');
    expect(pm.problems[0]).toMatch(/^DevStyle devstyle\.json: not valid JSON/);
    await pm.apply(own('default-light', 'mine-dark'), true);
    expect(
      pm.problems.some(
        (m) => m.startsWith('DevStyle profiles/mine-dark.css:') && m.includes('--ds-bg'),
      ),
    ).toBe(true);
  });
  it('an unreadable shared folder falls back to the built-ins and says so', async () => {
    const sink = new RecordingSink();
    const pm = new ProfileManager(new MemoryConfig(), failingHost, sink);
    await pm.install();
    const p = await pm.apply(follow, true);
    expect(p.id).toBe('default-dark');
    expect(sink.profile).toBe(BUILTIN_PROFILES['default-dark']);
    expect(pm.problems.join('\n')).toContain('could not install the built-in profiles');
    expect(pm.problems.join('\n')).toContain(
      'DevStyle folder: could not be read (operation not permitted)',
    );
    expect((await pm.available()).length).toBe(8);
  });
  it('a partial profile sits on top of the slot’s Default, so unset tokens keep a value', async () => {
    const tiny =
      '/* devstyle: name="Tiny" appearance=dark pair=default-light */\n:root { --ds-accent: #008080; }';
    const sink = new RecordingSink();
    const pm = new ProfileManager(
      new MemoryConfig(),
      await sharedFolder({ 'profiles/tiny.css': tiny }),
      sink,
    );
    await pm.apply(own('default-light', 'tiny'), true);
    expect(sink.profile.startsWith(BUILTIN_PROFILES['default-dark'] ?? 'x')).toBe(true);
    expect(sink.profile.indexOf('#008080')).toBeGreaterThan(sink.profile.indexOf('--ds-accent:'));
  });
  it('without a shared folder (iOS) uses the built-ins and DevTex’s own choice', async () => {
    const pm = new ProfileManager(new MemoryConfig(), null, new RecordingSink());
    expect(pm.canShare).toBe(false);
    expect(await pm.install()).toEqual([]);
    expect((await pm.apply(follow, false)).id).toBe('default-light');
    expect((await pm.apply({ ...follow, theme: 'paper-light' }, false)).id).toBe('paper-light');
    expect((await pm.available()).map((p) => p.id)).toContain('high-contrast-dark');
    await expect(pm.setShared('paper-light', 'paper-dark')).rejects.toThrow();
  });
  it('applies user.css on top and reloads only for user.css changes', async () => {
    const store = new MemoryConfig({ 'themes/user.css': ':root { --dt-bg: pink; }' });
    const sink = new RecordingSink();
    const pm = new ProfileManager(store, await sharedFolder(), sink);
    await pm.apply(follow, false);
    expect(sink.user).toContain('pink');
    expect(pm.affects(['themes/user.css'])).toBe(true);
    expect(pm.affects(['themes/Paper Light.css'])).toBe(false);
  });
  it('the Settings overrides go into the managed block of user.css, never into a profile', async () => {
    const store = new MemoryConfig({ 'themes/user.css': '.cm-line { letter-spacing: 1px; }\n' });
    const sink = new RecordingSink();
    const host = await sharedFolder();
    const before = new Map(host.files);
    const pm = new ProfileManager(store, host, sink);
    await pm.apply(follow, false);
    store.writes = [];
    await pm.saveOverrides(new Map([['--dt-editor-size', '16px']]));
    expect(store.writes).toEqual(['themes/user.css']);
    const user = store.files.get('themes/user.css') ?? '';
    expect(user).toContain('.cm-line { letter-spacing: 1px; }');
    expect(readManagedBlock(user).get('--dt-editor-size')).toBe('16px');
    expect(sink.user).toBe(user);
    expect(await pm.overrides()).toEqual(new Map([['--dt-editor-size', '16px']]));
    expect(host.files).toEqual(before);
  });
});

describe('migration from settings.jsonc (DevTex 1.0.4)', () => {
  const old =
    '{ "editor": { "fontFamily": "Fira Code", "fontSize": 14, "lineHeight": 1.4, "lineWrapping": true }, "colors": { "currentLine": "rgba(120, 120, 180, 0.10)", "matchingBracket": "rgba(1, 2, 3, 0.5)" } }';
  it('moves the changed values into user.css and drops the ones still at their defaults', async () => {
    const store = new MemoryConfig({ 'themes/user.css': '/* mine */\n' });
    const pm = new ProfileManager(store, await sharedFolder(), new RecordingSink());
    await pm.migrate(loadSettings(old).legacy);
    const user = store.files.get('themes/user.css') ?? '';
    expect(user.startsWith('/* mine */')).toBe(true);
    expect(readManagedBlock(user)).toEqual(
      new Map([
        ['--dt-editor-font', 'Fira Code'],
        ['--dt-editor-line-height', '1.4'],
        ['--dt-editor-matching-bracket', 'rgba(1, 2, 3, 0.5)'],
      ]),
    );
    expect(pm.notes[0]).toMatch(
      /^settings\.jsonc: editor\.fontFamily, .* removed \(your values moved to themes\/user\.css\)/,
    );
  });
  it('writes nothing when every value is at its old default', async () => {
    const store = new MemoryConfig();
    const pm = new ProfileManager(store, null, new RecordingSink());
    await pm.migrate(
      loadSettings(
        '{ "editor": { "fontSize": 14 }, "colors": { "brokenCode": "rgba(230, 60, 60, 0.35)" } }',
      ).legacy,
    );
    expect(store.writes).toEqual([]);
    expect(pm.notes[0]).toContain('they were at their defaults');
    await pm.migrate(loadSettings('{ "ui": { "zoom": 1 } }').legacy);
    expect(pm.notes).toHaveLength(1);
  });
});

describe('migration from DevTex 1.0.5–1.0.6 profiles', () => {
  const legacyUi = (theme: string, themeDark: string): StyleChoice => ({
    followSharedStyle: true,
    theme,
    themeDark,
  });
  it('deletes untouched copies and maps their names to the DevStyle built-ins', async () => {
    const store = new MemoryConfig({
      'themes/Default Light.css': legacyDefaultLight,
      'themes/Default Dark.css': legacyDefaultDarkMigrated,
      'themes/user.css': '/* keep */',
    });
    const host = await sharedFolder();
    const before = new Map(host.files);
    const pm = new ProfileManager(store, host, new RecordingSink());
    const next = await pm.migrateThemes(legacyUi('Default Light', 'Default Dark'));
    expect(next).toEqual({
      followSharedStyle: true,
      theme: 'default-light',
      themeDark: 'default-dark',
    });
    expect(store.deleted.sort()).toEqual(['themes/Default Dark.css', 'themes/Default Light.css']);
    expect(store.files.get('themes/user.css')).toBe('/* keep */');
    expect(host.files).toEqual(before);
    expect(await pm.migrateThemes(next ?? follow)).toBeNull();
  });
  it('turns an edited profile into a DevStyle profile, keeps showing it, and leaves other apps alone', async () => {
    const edited = legacyPaperDark.replace('--dt-accent:', '--dt-accent: #008080; --dt-x-unused:');
    const store = new MemoryConfig({
      'themes/Paper Dark.css': edited,
      'themes/My Theme.css':
        '/* devtex: appearance=light */\n:root { --dt-bg: #fafafa; --dt-preview-math: teal; }',
    });
    const host = await sharedFolder();
    const config = host.files.get(CONFIG_FILE);
    const pm = new ProfileManager(store, host, new RecordingSink());
    const next = await pm.migrateThemes(legacyUi('My Theme', 'Paper Dark'));
    expect(next).toEqual({
      followSharedStyle: false,
      theme: 'my-theme-devtex',
      themeDark: 'paper-dark-devtex',
    });
    expect(host.files.get(CONFIG_FILE)).toBe(config);
    const paper = host.files.get('profiles/paper-dark-devtex.css') ?? '';
    expect(parseHeader(paper)).toEqual({
      name: 'Paper Dark (DevTex)',
      appearance: 'dark',
      pair: 'paper-light',
    });
    expect(paper).toContain('--ds-accent: #008080');
    const mine = host.files.get('profiles/my-theme-devtex.css') ?? '';
    expect(parseHeader(mine)).toEqual({
      name: 'My Theme (DevTex)',
      appearance: 'light',
      pair: 'default-dark',
    });
    expect(mine).toContain('--ds-bg: #fafafa');
    expect(mine).toContain('--dt-preview-math: teal');
    expect(store.deleted.sort()).toEqual(['themes/My Theme.css', 'themes/Paper Dark.css']);
    expect(pm.notes.join(' ')).toContain('Moved your edited profiles');
    // the converted profile loads and shows
    const sink = new RecordingSink();
    const shown = new ProfileManager(store, host, sink);
    expect((await shown.apply(next ?? follow, true)).id).toBe('paper-dark-devtex');
    expect(shown.problems).toEqual([]);
    expect(sink.profile).toContain('--ds-accent: #008080');
  });
  it('pairs an edited Light/Dark pair with each other', async () => {
    const store = new MemoryConfig({
      'themes/Default Light.css': `${legacyDefaultLight}\n.x { color: red; }\n`,
      'themes/Default Dark.css': legacyDefaultDark.replace('#8f9bff', '#9fabff'),
    });
    const host = await sharedFolder();
    await new ProfileManager(store, host, new RecordingSink()).migrateThemes(
      legacyUi('Default Light', 'Default Dark'),
    );
    const light = parseHeader(host.files.get('profiles/default-light-devtex.css') ?? '');
    const dark = parseHeader(host.files.get('profiles/default-dark-devtex.css') ?? '');
    expect(light?.pair).toBe('default-dark-devtex');
    expect(dark?.pair).toBe('default-light-devtex');
  });
  it('never overwrites a DevStyle profile that already exists', async () => {
    const store = new MemoryConfig({ 'themes/Paper Dark.css': `${legacyPaperDark}/* edit */\n` });
    const host = await sharedFolder({ 'profiles/paper-dark-devtex.css': '/* already here */' });
    await new ProfileManager(store, host, new RecordingSink()).migrateThemes(
      legacyUi('Default Light', 'Paper Dark'),
    );
    expect(host.files.get('profiles/paper-dark-devtex.css')).toBe('/* already here */');
  });
  it('keeps the file and shows the built-in when the shared folder cannot be written', async () => {
    const store = new MemoryConfig({ 'themes/Paper Dark.css': `${legacyPaperDark}/* edit */\n` });
    const host: FolderHost = { ...memoryHost(), write: () => Promise.reject(new Error('denied')) };
    const pm = new ProfileManager(store, host, new RecordingSink());
    const next = await pm.migrateThemes(legacyUi('Default Light', 'Paper Dark'));
    expect(next?.themeDark).toBe('paper-dark');
    expect(next?.followSharedStyle).toBe(true);
    expect(store.files.has('themes/Paper Dark.css')).toBe(true);
    expect(pm.notes.join(' ')).toContain('could not be copied to DevStyle (denied)');
  });
  it('without a shared folder (iOS) maps names to the built-ins and keeps edited files', async () => {
    const store = new MemoryConfig({
      'themes/Paper Dark.css': `${legacyPaperDark}/* edit */\n`,
      'themes/Default Light.css': legacyDefaultLight,
    });
    const pm = new ProfileManager(store, null, new RecordingSink());
    const next = await pm.migrateThemes(legacyUi('Default Light', 'Paper Dark'));
    expect(next).toEqual({
      followSharedStyle: true,
      theme: 'default-light',
      themeDark: 'paper-dark',
    });
    expect(store.files.has('themes/Paper Dark.css')).toBe(true);
    expect(store.deleted).toEqual(['themes/Default Light.css']);
  });
  it('converts settings that name a profile with no file left', async () => {
    const pm = new ProfileManager(new MemoryConfig(), await sharedFolder(), new RecordingSink());
    expect(await pm.migrateThemes(legacyUi('High Contrast Light', 'Gone Dark'))).toEqual({
      followSharedStyle: true,
      theme: 'high-contrast-light',
      themeDark: 'default-dark',
    });
  });
});

describe('Settings dialog profile lists', () => {
  const profiles: ProfileInfo[] = [
    { id: 'paper-dark', name: 'Paper Dark', appearance: 'dark', pair: 'paper-light' },
    { id: 'paper-light', name: 'Paper Light', appearance: 'light', pair: 'paper-dark' },
  ];
  it('lists the slot’s own appearance first and keeps a missing current value', () => {
    expect(profileOptions(profiles, 'light', 'paper-light')).toEqual([
      { value: 'paper-light', label: 'Paper Light' },
      { value: 'paper-dark', label: 'Paper Dark (dark)' },
    ]);
    expect(profileOptions(profiles, 'dark', 'gone').at(-1)).toEqual({
      value: 'gone',
      label: 'gone (missing)',
    });
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
