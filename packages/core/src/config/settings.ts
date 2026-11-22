/**
 * settings.jsonc loader. Invalid config never crashes: every bad value falls
 * back to its default and is reported as an error string for the UI.
 */
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';

export interface Settings {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    lineWrapping: boolean;
  };
  colors: {
    currentLine: string;
    matchingBracket: string;
    brokenCode: string;
    selectionMatch: string;
    environmentPair: string;
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
}

export const DEFAULT_SETTINGS: Settings = {
  editor: {
    fontFamily: 'SF Mono, Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.5,
    lineWrapping: true,
  },
  colors: {
    currentLine: 'rgba(120, 120, 180, 0.10)',
    matchingBracket: 'rgba(80, 200, 120, 0.35)',
    brokenCode: 'rgba(230, 60, 60, 0.35)',
    selectionMatch: 'rgba(255, 210, 0, 0.25)',
    environmentPair: 'rgba(80, 160, 255, 0.25)',
  },
  preview: { debounceMs: 120, timingHud: false },
  compile: { latexmkPath: '', badBoxes: 'none' },
  citations: { betterBibTex: true },
};

export interface Loaded<T> {
  value: T;
  errors: string[];
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

const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-zA-Z]+)$/;

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

export function loadSettings(text: string | null): Loaded<Settings> {
  const errors: string[] = [];
  if (text === null) return { value: DEFAULT_SETTINGS, errors };
  const raw = parseJsoncText(text, 'settings.jsonc', errors);
  if (raw === undefined) return { value: DEFAULT_SETTINGS, errors };
  const s = merge(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    raw,
    '',
    errors,
  ) as unknown as Settings;
  // range / enum validation
  const fixes: [boolean, () => void, string][] = [
    [
      s.editor.fontSize < 6 || s.editor.fontSize > 72,
      () => (s.editor.fontSize = DEFAULT_SETTINGS.editor.fontSize),
      'editor.fontSize: must be 6–72',
    ],
    [
      s.editor.lineHeight < 1 || s.editor.lineHeight > 3,
      () => (s.editor.lineHeight = DEFAULT_SETTINGS.editor.lineHeight),
      'editor.lineHeight: must be 1–3',
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
  for (const k of Object.keys(s.colors) as (keyof Settings['colors'])[]) {
    if (!CSS_COLOR_RE.test(s.colors[k])) {
      errors.push(`colors.${k}: not a CSS colour (using default)`);
      s.colors[k] = DEFAULT_SETTINGS.colors[k];
    }
  }
  return { value: s, errors };
}

/** Serialize the three UI-editable groups back to JSONC (comments are not preserved). */
export function serializeSettings(s: Settings): string {
  return `// DevTex settings (JSONC). Invalid values fall back to defaults.\n${JSON.stringify(s, null, 2)}\n`;
}
