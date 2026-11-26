import { describe, expect, it } from 'vitest';
import {
  ALWAYS_RESERVED,
  DEFAULT_KEYMAP,
  isReserved,
  loadKeymap,
  normalizeKey,
  toCodeMirrorKey,
} from './keymap.js';
import { DEFAULT_SETTINGS, loadSettings, serializeSettings } from './settings.js';
import { loadSyntaxFile } from './syntax.js';
import { DEFAULT_TOOLBARS, loadToolbars } from './toolbars.js';

describe('settings.jsonc', () => {
  it('missing file gives defaults', () => {
    expect(loadSettings(null)).toEqual({ value: DEFAULT_SETTINGS, errors: [], legacy: null });
  });
  it('accepts JSONC with comments and trailing commas, overlaying defaults', () => {
    const r = loadSettings(
      '// mine\n{ "editor": { "lineWrapping": false, }, "ui": { "theme": "Paper Light" } }',
    );
    expect(r.errors).toEqual([]);
    expect(r.value.editor.lineWrapping).toBe(false);
    expect(r.value.editor.hidePreamble).toBe(true);
    expect(r.value.ui.theme).toBe('Paper Light');
    expect(r.value.ui.themeDark).toBe('Default Dark');
  });
  it('invalid JSON never crashes: defaults plus an error', () => {
    const r = loadSettings('{ "editor": ');
    expect(r.value).toEqual(DEFAULT_SETTINGS);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it('wrong types, out-of-range values, bad profile names and unknown keys fall back individually', () => {
    const r = loadSettings(
      '{ "editor": { "lineWrapping": "yes" }, "ui": { "zoom": 9, "themeDark": "../x" }, "nope": 1, "preview": { "timingHud": true } }',
    );
    expect(r.value.editor.lineWrapping).toBe(DEFAULT_SETTINGS.editor.lineWrapping);
    expect(r.value.ui.zoom).toBe(1);
    expect(r.value.ui.themeDark).toBe('Default Dark');
    expect(r.value.preview.timingHud).toBe(true);
    expect(r.errors).toHaveLength(4);
    expect(DEFAULT_SETTINGS.preview.timingHud).toBe(false);
  });
  it('pre-1.0.5 colour and font keys are moved out, not reported as errors', () => {
    const r = loadSettings(
      '{ "editor": { "fontFamily": "Fira Code", "fontSize": 16, "lineHeight": 1.4, "lineWrapping": false }, "colors": { "currentLine": "#223344", "brokenCode": "url(x);}" } }',
    );
    expect(r.errors).toEqual([]);
    expect(r.value.editor.lineWrapping).toBe(false);
    expect(r.legacy?.keys).toEqual([
      'editor.fontFamily',
      'editor.fontSize',
      'editor.lineHeight',
      'colors.currentLine',
      'colors.brokenCode',
    ]);
    expect([...(r.legacy?.vars ?? [])]).toEqual([
      ['--dt-editor-font', 'Fira Code'],
      ['--dt-editor-size', '16px'],
      ['--dt-editor-line-height', '1.4'],
      ['--dt-editor-active-line', '#223344'],
    ]);
    expect(JSON.parse(serializeSettings(r.value).replace(/^\/\/.*\n/, ''))).not.toHaveProperty(
      'colors',
    );
  });
});

describe('keymap.json', () => {
  it('normalizes keys', () => {
    expect(normalizeKey('Mod-Shift-B')).toBe('Shift-Cmd-b');
    expect(normalizeKey('shift-cmd-b')).toBe('Shift-Cmd-b');
    expect(normalizeKey('Cmd-Alt-[')).toBe('Alt-Cmd-[');
    expect(normalizeKey('Hyper-x')).toBeNull();
    expect(toCodeMirrorKey('Shift-Cmd-b')).toBe('Shift-Mod-b');
  });
  it('always reserves Cmd+Q, W, C, V, X, Z, Shift+Z, A, H, M, Tab, Space', () => {
    for (const k of [
      'Mod-q',
      'Mod-w',
      'Mod-c',
      'Mod-v',
      'Mod-x',
      'Mod-z',
      'Mod-Shift-z',
      'Mod-a',
      'Mod-h',
      'Mod-m',
      'Mod-Tab',
      'Mod-Space',
    ]) {
      expect(isReserved(k)).toBe(true);
    }
    expect(ALWAYS_RESERVED).toHaveLength(12);
  });
  it('no default binding is reserved and defaults are unique', () => {
    for (const b of DEFAULT_KEYMAP) expect(isReserved(b.key)).toBe(false);
    const keys = DEFAULT_KEYMAP.map((b) => normalizeKey(b.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('applies remaps, unbinds, and reports reserved/unknown/malformed bindings instead of applying them', () => {
    const r = loadKeymap(
      JSON.stringify([
        { key: 'Mod-e', command: 'format.emph' },
        { key: 'Mod-w', command: 'file.save' },
        { key: 'Ctrl-Cmd-f', command: 'file.save' },
        { key: 'Mod-b', command: '' },
        { key: 'Mod-k', command: 'no.such' },
        { key: 'Bogus-x', command: 'file.save' },
        { nope: 1 },
      ]),
      new Set(['format.emph', 'file.save']),
    );
    const map = new Map(r.value.bindings.map((b) => [b.key, b.command]));
    expect(map.get('Cmd-e')).toBe('format.emph');
    expect(map.has('Cmd-b')).toBe(false);
    expect(map.has('Cmd-w')).toBe(false);
    expect(r.value.conflicts.map((c) => c.key)).toEqual([
      'Mod-w',
      'Ctrl-Cmd-f',
      'Mod-k',
      'Bogus-x',
    ]);
    expect(r.errors.some((e) => e.includes('reserved'))).toBe(true);
    expect(r.errors.some((e) => e.includes('keymap.json[6]'))).toBe(true);
  });
  it('invalid keymap file falls back to defaults', () => {
    const r = loadKeymap('{oops');
    expect(r.value.bindings).toHaveLength(DEFAULT_KEYMAP.length);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('toolbars.json', () => {
  it('defaults when absent; parses string or object items; reports unknown commands', () => {
    expect(loadToolbars(null).value).toEqual(DEFAULT_TOOLBARS);
    const r = loadToolbars(
      '[{ "id": "t", "title": "Mine", "visible": false, "items": ["file.save", { "command": "x.y", "label": "X" }, { "command": "compile.pdf", "label": "Build" }] }, { "id": "t" }]',
      new Set(['file.save', 'compile.pdf']),
    );
    expect(r.value).toEqual([
      {
        id: 't',
        title: 'Mine',
        visible: false,
        items: [{ command: 'file.save' }, { command: 'compile.pdf', label: 'Build' }],
      },
    ]);
    expect(r.errors).toEqual([
      'toolbars.json[0].items[1]: unknown command x.y',
      'toolbars.json[1]: duplicate id t',
    ]);
  });
});

describe('syntax/*.json', () => {
  it('loads valid rules and drops invalid ones with errors', () => {
    const r = loadSyntaxFile(
      'mine.json',
      JSON.stringify({
        scope: 'embedded',
        environments: ['rcode'],
        rules: [
          { match: '\\\\todo\\b', token: 'todo', color: '#d33', fontStyle: 'bold' },
          { match: '(', token: 'bad' },
          { match: 'x', token: '1bad' },
          { match: 'y', token: 'ok', color: 'url(x)' },
        ],
      }),
    );
    expect(r.value).toEqual({
      name: 'mine',
      scope: 'embedded',
      environments: ['rcode'],
      rules: [
        { match: '\\\\todo\\b', flags: '', token: 'todo', color: '#d33', fontStyle: 'bold' },
        { match: 'y', flags: '', token: 'ok' },
      ],
    });
    expect(r.errors).toHaveLength(3);
    expect(loadSyntaxFile('x.json', '[]').value).toBeNull();
  });
  it('rules may leave out color and fontStyle so a style profile styles them', () => {
    const r = loadSyntaxFile(
      'mine.json',
      '{ "name": "mine", "rules": [ { "match": "\\\\todo", "token": "todo" }, { "match": "x", "token": "x", "color": "#d33" } ] }',
    );
    expect(r.errors).toEqual([]);
    expect(r.value?.rules[0]).not.toHaveProperty('color');
    expect(r.value?.rules[0]).not.toHaveProperty('fontStyle');
    expect(r.value?.rules[0]?.token).toBe('todo');
    expect(r.value?.rules[1]?.color).toBe('#d33');
  });
});

describe('toolbar separators', () => {
  it('default main toolbar: Live label and dividers around Live/PDF view', () => {
    const main = DEFAULT_TOOLBARS[0]?.items.map((i) => i.label ?? i.command);
    expect(main).toEqual([
      'Open',
      'Save',
      'Compile',
      '|',
      'Live',
      'PDF view',
      '|',
      'Outline',
      'Problems',
      'Preamble',
      'Push',
    ]);
  });

  it('toolbars.json accepts "|", "-" and {separator:true}', () => {
    const r = loadToolbars(
      JSON.stringify([{ id: 't', items: ['a.b', '|', '-', { separator: true }, 'c.d'] }]),
      new Set(['a.b', 'c.d']),
    );
    expect(r.errors).toEqual([]);
    expect(r.value[0]?.items.map((i) => i.command)).toEqual(['a.b', '|', '|', '|', 'c.d']);
  });
});
