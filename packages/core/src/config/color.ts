/**
 * CSS colour parsing for the settings colour picker: highlight colours are
 * usually translucent (rgba), but <input type="color"> only edits #rrggbb, so
 * the picker edits RGB and keeps the alpha separately.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba() (comma or space syntax). Named colours return null. */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const n = (i: number): number => Number.parseInt(full.slice(i, i + 2), 16);
    return {
      r: n(0),
      g: n(2),
      b: n(4),
      a: full.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1,
    };
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s)?.[1];
  if (fn === undefined) return null;
  const parts = fn.split(/\s*[,/]\s*|\s+/).filter((p) => p !== '');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const channel = (p: string): number | null => {
    const v = Number.parseFloat(p);
    if (!Number.isFinite(v)) return null;
    return p.endsWith('%') ? clamp255((v / 100) * 255) : clamp255(v);
  };
  const [r, g, b] = parts.slice(0, 3).map(channel);
  if (
    r === null ||
    g === null ||
    b === null ||
    r === undefined ||
    g === undefined ||
    b === undefined
  )
    return null;
  let a = 1;
  const ap = parts[3];
  if (ap !== undefined) {
    const v = Number.parseFloat(ap);
    if (!Number.isFinite(v)) return null;
    a = clamp01(ap.endsWith('%') ? v / 100 : v);
  }
  return { r, g, b, a };
}

export function toHex6(c: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  return `#${[c.r, c.g, c.b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
}

/** `#rrggbb` when opaque, else `rgba(r, g, b, a)` (alpha rounded to 2 decimals). */
export function formatCssColor(c: Rgba): string {
  const a = Math.round(clamp01(c.a) * 100) / 100;
  if (a >= 1) return toHex6(c);
  return `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${a})`;
}

/** Replace the RGB of `current` with the picked `#rrggbb`, keeping its alpha. */
export function withPickedRgb(current: string, pickedHex: string): string {
  const picked = parseCssColor(pickedHex);
  if (picked === null) return current;
  const a = parseCssColor(current)?.a ?? 1;
  return formatCssColor({ ...picked, a });
}
