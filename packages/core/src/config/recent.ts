/**
 * recent.json: the most recently opened project folders, newest first.
 */
export const MAX_RECENT = 15;

/** Parse recent.json; anything malformed yields an empty list (it is only a convenience). */
export function loadRecent(text: string | null): string[] {
  if (text === null) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const p of raw)
      if (typeof p === 'string' && p !== '' && !out.includes(p) && out.length < MAX_RECENT)
        out.push(p);
    return out;
  } catch {
    return [];
  }
}

/** Move `path` to the front, de-duplicated, capped at `max`. */
export function addRecent(list: readonly string[], path: string, max = MAX_RECENT): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max);
}

export function removeRecent(list: readonly string[], path: string): string[] {
  return list.filter((p) => p !== path);
}

export function serializeRecent(list: readonly string[]): string {
  return `${JSON.stringify(list, null, 2)}\n`;
}
