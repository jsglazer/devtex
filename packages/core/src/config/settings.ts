/**
 * settings.jsonc loader. Invalid config never crashes: every bad value falls
 * back to its default and is reported as an error string for the UI.
 */
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { extractLegacyStyle, isProfileSetting, type LegacyStyle } from './theme.js';

export interface Settings {
  editor: {
    lineWrapping: boolean;
    /** Fold the preamble when a file is opened (Show/Hide Preamble toggles it). */
    hidePreamble: boolean;
  };
  preview: {
    debounceMs: number;
    /** Debug timing HUD (parse/render/typeset ms per edit) in the status bar. */
    timingHud: boolean;
  };
  compile: {
    /** Override for the latexmk path; empty = resolve from the login shell PATH. */
    latexmkPath: string;
    badBoxes: 'both' | 'overfull' | 'underfull' | 'none';
  };
  citations: {
    betterBibTex: boolean;
  };
  ui: {
    /** Whole-interface zoom (⌘+ / ⌘− / ⌘0), 0.5–3. */
    zoom: number;
    /**
     * Follow the style chosen for every app in DevStyle's shared folder
     * (macOS). When false, `theme` / `themeDark` pick DevTex's own.
     */
    followSharedStyle: boolean;
    /** DevStyle profile id used in light mode when not following the shared style (and on iOS). */
    theme: string;
    /** DevStyle profile id used in dark mode when not following the shared style (and on iOS). */
    themeDark: string;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  editor: {
    lineWrapping: true,
    hidePreamble: true,
  },
  preview: { debounceMs: 120, timingHud: false },
  compile: { latexmkPath: '', badBoxes: 'none' },
  citations: { betterBibTex: true },
  ui: { zoom: 1, followSharedStyle: true, theme: 'default-light', themeDark: 'default-dark' },
};

export interface Loaded<T> {
  value: T;
  errors: string[];
}

export interface LoadedSettings extends Loaded<Settings> {
  /** Pre-1.0.5 colour/font keys found in the file (to migrate into themes/user.css). */
  legacy: LegacyStyle | null;
}

export function parseJsoncText(text: string, file: string, errors: string[]): unknown {
  const parseErrors: ParseError[] = [];
  const v: unknown = parseJsonc(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  for (const e of parseErrors)
    errors.push(`${file}: ${printParseErrorCode(e.error)} at offset ${e.offset}`);
  return parseErrors.length > 0 ? undefined : v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Overlay `input` on `defaults` key by key, type-checking against the default's type. */
function merge<T extends Record<string, unknown>>(
  defaults: T,
  input: unknown,
  path: string,
  errors: string[],
): T {
  if (input === undefined) return defaults;
  if (!isRecord(input)) {
    errors.push(`${path}: expected an object`);
    return defaults;
  }
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(input)) {
    const d = defaults[k];
    const p = path === '' ? k : `${path}.${k}`;
    if (d === undefined) {
      errors.push(`${p}: unknown setting (ignored)`);
      continue;
    }
    if (isRecord(d)) out[k] = merge(d, v, p, errors);
    else if (typeof d !== typeof v) errors.push(`${p}: expected ${typeof d} (using default)`);
    else out[k] = v;
  }
  return out as T;
}

export function loadSettings(text: string | null): LoadedSettings {
  const errors: string[] = [];
  const fresh = (): Settings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  if (text === null) return { value: fresh(), errors, legacy: null };
  const raw = parseJsoncText(text, 'settings.jsonc', errors);
  if (raw === undefined) return { value: fresh(), errors, legacy: null };
  const legacy = extractLegacyStyle(raw);
  const s = merge(
    fresh() as unknown as Record<string, unknown>,
    raw,
    '',
    errors,
  ) as unknown as Settings;
  // range / enum validation
  const fixes: [boolean, () => void, string][] = [
    [
      !(s.ui.zoom >= 0.5 && s.ui.zoom <= 3),
      () => (s.ui.zoom = DEFAULT_SETTINGS.ui.zoom),
      'ui.zoom: must be 0.5–3',
    ],
    [
      !isProfileSetting(s.ui.theme),
      () => (s.ui.theme = DEFAULT_SETTINGS.ui.theme),
      'ui.theme: not a valid style profile id',
    ],
    [
      !isProfileSetting(s.ui.themeDark),
      () => (s.ui.themeDark = DEFAULT_SETTINGS.ui.themeDark),
      'ui.themeDark: not a valid style profile id',
    ],
    [
      s.preview.debounceMs < 0 || s.preview.debounceMs > 2000,
      () => (s.preview.debounceMs = DEFAULT_SETTINGS.preview.debounceMs),
      'preview.debounceMs: must be 0–2000',
    ],
    [
      !['both', 'overfull', 'underfull', 'none'].includes(s.compile.badBoxes),
      () => (s.compile.badBoxes = DEFAULT_SETTINGS.compile.badBoxes),
      'compile.badBoxes: must be both|overfull|underfull|none',
    ],
  ];
  for (const [bad, fix, msg] of fixes) {
    if (bad) {
      fix();
      errors.push(`${msg} (using default)`);
    }
  }
  return { value: s, errors, legacy };
}

/** Serialize the three UI-editable groups back to JSONC (comments are not preserved). */
export function serializeSettings(s: Settings): string {
  return `// DevTex settings (JSONC). Invalid values fall back to defaults.\n${JSON.stringify(s, null, 2)}\n`;
}
