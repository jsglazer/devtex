/**
 * keymap.json loader. Default shortcuts plus user remaps. Any binding on the
 * reserved list (macOS system, WKWebView editing and iPadOS hardware-keyboard
 * shortcuts) is rejected and reported, never applied.
 *
 * Key syntax is CodeMirror's: modifiers `Mod` (Cmd on Apple), `Cmd`/`Meta`,
 * `Ctrl`, `Alt`/`Opt`, `Shift`, joined with `-`, then the key: `Mod-Shift-b`.
 */
import { parseJsoncText, type Loaded } from './settings.js';

export interface KeyBinding {
  key: string;
  command: string;
}

/** Always reserved (decision): Cmd+Q, W, C, V, X, Z, Shift+Z, A, H, M, Tab, Space. */
export const ALWAYS_RESERVED = [
  'Cmd-q',
  'Cmd-w',
  'Cmd-c',
  'Cmd-v',
  'Cmd-x',
  'Cmd-z',
  'Cmd-Shift-z',
  'Cmd-a',
  'Cmd-h',
  'Cmd-m',
  'Cmd-Tab',
  'Cmd-Space',
];

/** Further macOS / WKWebView / iPadOS hardware-keyboard shortcuts. */
export const PLATFORM_RESERVED = [
  'Cmd-Alt-h', // hide others
  'Cmd-Alt-m', // minimise all
  'Cmd-Alt-Escape', // force quit
  'Ctrl-Cmd-q', // lock screen
  'Ctrl-Cmd-f', // full screen
  'Ctrl-Cmd-Space', // emoji & symbols
  'Cmd-Shift-3',
  'Cmd-Shift-4',
  'Cmd-Shift-5', // screenshots
  'Cmd-`',
  'Cmd-Shift-`', // cycle windows
  'Cmd-,', // settings (app menu)
  'Cmd-Shift-q', // log out
  'Cmd-Alt-d', // dock
  'Cmd-Shift-h', // iPadOS home
  'Ctrl-Space', // input source
  'Cmd-Alt-Space', // Finder search
  'Fn-e',
  'Fn-f',
  'Fn-a',
  'Fn-n',
  'Fn-c',
  'Fn-h',
  'Fn-q', // iPadOS Globe shortcuts
  'Cmd-Shift-a', // iPadOS: app library (also Safari)
];

const MOD_ORDER = ['Fn', 'Ctrl', 'Alt', 'Shift', 'Cmd'];
const MOD_ALIASES: Record<string, string> = {
  mod: 'Cmd',
  cmd: 'Cmd',
  meta: 'Cmd',
  command: 'Cmd',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  opt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  fn: 'Fn',
  globe: 'Fn',
};

/**
 * Normalize to a canonical form: modifiers in fixed order, `Mod`→`Cmd`,
 * single letters lower-case (Shift is explicit), named keys capitalized.
 * Returns null for an unparsable key.
 */
export function normalizeKey(key: string): string | null {
  const parts = key
    .split(/-(?!$)/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1] ?? '';
  const mods = new Set<string>();
  for (const p of parts.slice(0, -1)) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (m === undefined) return null;
    mods.add(m);
  }
  let k = last;
  if (k.length === 1) k = k.toLowerCase();
  else if (k.toLowerCase() === 'space') k = 'Space';
  else if (k.toLowerCase() === 'tab') k = 'Tab';
  else if (k.toLowerCase() === 'esc' || k.toLowerCase() === 'escape') k = 'Escape';
  else if (k.toLowerCase() === 'enter' || k.toLowerCase() === 'return') k = 'Enter';
  else k = k.charAt(0).toUpperCase() + k.slice(1);
  const ordered = MOD_ORDER.filter((m) => mods.has(m));
  return [...ordered, k].join('-');
}

const RESERVED = new Set(
  [...ALWAYS_RESERVED, ...PLATFORM_RESERVED].map((k) => normalizeKey(k) ?? k),
);

export function isReserved(key: string): boolean {
  const n = normalizeKey(key);
  return n !== null && RESERVED.has(n);
}

/** Built-in default shortcuts; all checked against the reserved list by tests. */
export const DEFAULT_KEYMAP: KeyBinding[] = [
  { key: 'Mod-b', command: 'format.bold' },
  { key: 'Mod-i', command: 'format.italic' },
  { key: 'Mod-Shift-e', command: 'format.emph' },
  { key: 'Mod-Shift-t', command: 'format.texttt' },
  { key: 'Mod-s', command: 'file.save' },
  { key: 'Mod-o', command: 'file.openProject' },
  { key: 'Mod-r', command: 'compile.pdf' },
  { key: 'Mod-Shift-r', command: 'compile.stop' },
  { key: 'Mod-j', command: 'sync.sourceToPreview' },
  { key: 'Mod-Shift-j', command: 'sync.sourceToPdf' },
  { key: 'Mod-1', command: 'pane.focusEditor' },
  { key: 'Mod-2', command: 'pane.togglePreview' },
  { key: 'Mod-3', command: 'pane.togglePdf' },
  { key: 'Mod-4', command: 'pane.toggleOutline' },
  { key: 'Mod-5', command: 'pane.toggleProblems' },
  { key: 'Mod-f', command: 'search.find' },
  { key: 'Mod-Alt-f', command: 'search.replace' },
  { key: 'Mod-g', command: 'search.next' },
  { key: 'Mod-Shift-g', command: 'search.previous' },
  { key: 'Mod-/', command: 'edit.toggleComment' },
  { key: 'Mod-Alt-[', command: 'edit.fold' },
  { key: 'Mod-Alt-]', command: 'edit.unfold' },
  { key: 'Mod-Shift-p', command: 'palette.open' },
  { key: 'Mod-Shift-s', command: 'palette.sectioning' },
  { key: 'Mod-Shift-b', command: 'palette.environments' },
  { key: 'Mod-Shift-k', command: 'palette.size' },
  { key: 'Mod-Shift-l', command: 'palette.alignment' },
  { key: 'Mod-d', command: 'edit.selectNextOccurrence' },
  { key: 'Mod-Alt-ArrowUp', command: 'edit.addCursorAbove' },
  { key: 'Mod-Alt-ArrowDown', command: 'edit.addCursorBelow' },
  { key: 'Mod-Shift-u', command: 'git.pushReview' },
  { key: 'Mod-Alt-u', command: 'git.submit' },
  { key: 'Mod-Alt-t', command: 'view.toggleToolbars' },
];

export interface KeymapResult {
  bindings: KeyBinding[];
  conflicts: { key: string; command: string; reason: string }[];
}

/**
 * Build the effective keymap: defaults overridden by user bindings (a user
 * binding replaces any default on the same key, and a `command` mapped to
 * "" unbinds that key). Reserved or malformed keys are reported, not applied.
 */
export function loadKeymap(
  text: string | null,
  knownCommands?: ReadonlySet<string>,
): Loaded<KeymapResult> {
  const errors: string[] = [];
  const conflicts: KeymapResult['conflicts'] = [];
  const map = new Map<string, string>();
  for (const b of DEFAULT_KEYMAP) {
    const n = normalizeKey(b.key);
    if (n !== null && !RESERVED.has(n)) map.set(n, b.command);
  }
  if (text !== null) {
    const raw = parseJsoncText(text, 'keymap.json', errors);
    if (raw !== undefined && !Array.isArray(raw))
      errors.push('keymap.json: expected an array of { "key", "command" }');
    if (Array.isArray(raw)) {
      raw.forEach((entry: unknown, i) => {
        if (typeof entry !== 'object' || entry === null) {
          errors.push(`keymap.json[${i}]: expected an object`);
          return;
        }
        const e = entry as Record<string, unknown>;
        const key = e['key'];
        const command = e['command'];
        if (typeof key !== 'string' || typeof command !== 'string') {
          errors.push(`keymap.json[${i}]: "key" and "command" must be strings`);
          return;
        }
        const n = normalizeKey(key);
        if (n === null) {
          conflicts.push({ key, command, reason: 'unparsable key' });
          return;
        }
        if (RESERVED.has(n)) {
          conflicts.push({
            key,
            command,
            reason: `${n} is reserved by macOS, WKWebView or iPadOS`,
          });
          return;
        }
        if (command === '') {
          map.delete(n);
          return;
        }
        if (knownCommands !== undefined && !knownCommands.has(command)) {
          conflicts.push({ key, command, reason: `unknown command ${command}` });
          return;
        }
        map.set(n, command);
      });
    }
  }
  for (const c of conflicts)
    errors.push(`keymap.json: ${c.key} → ${c.command} not applied (${c.reason})`);
  const bindings = [...map.entries()].map(([key, command]) => ({ key, command }));
  return { value: { bindings, conflicts }, errors };
}

/** Canonical key -> CodeMirror key string (`Cmd` -> `Mod`, `Alt` stays). */
export function toCodeMirrorKey(canonical: string): string {
  return canonical.replace(/(^|-)Cmd(?=-)/, '$1Mod');
}
