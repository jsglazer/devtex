/**
 * External-change policy for shared .tex files (Obsidian / Obsidian Sync can
 * write the same file). Stamps (mtime + SHA-256) are produced by the Rust
 * core; this module only decides. The Rust save command independently
 * re-checks the stamp before every write, so no save path can overwrite an
 * external edit.
 */

export interface FileStamp {
  mtimeMs: number;
  /** SHA-256 hex of the file bytes. */
  hash: string;
}

export type ExternalChangeAction =
  /** Nothing changed on disk. */
  | { kind: 'none' }
  /** Disk changed, buffer clean: reload silently. */
  | { kind: 'reload' }
  /** Disk changed, buffer dirty: ask (keep mine / load disk / show diff). Never overwrite. */
  | { kind: 'conflict' }
  /** File removed on disk. */
  | { kind: 'deleted'; dirty: boolean };

export function sameStamp(a: FileStamp, b: FileStamp): boolean {
  // content hash is authoritative; mtime alone can change without content change (touch, sync)
  return a.hash === b.hash;
}

export function decideExternalChange(
  known: FileStamp,
  disk: FileStamp | null,
  dirty: boolean,
): ExternalChangeAction {
  if (disk === null) return { kind: 'deleted', dirty };
  if (sameStamp(known, disk)) return { kind: 'none' };
  return dirty ? { kind: 'conflict' } : { kind: 'reload' };
}

export type ConflictChoice = 'keepMine' | 'loadDisk' | 'showDiff';

/** A minimal line diff (LCS) for the "show diff" choice. */
export interface DiffLine {
  op: ' ' | '-' | '+';
  text: string;
}

export function lineDiff(mine: string, disk: string): DiffLine[] {
  const a = mine.split('\n');
  const b = disk.split('\n');
  // trim common prefix/suffix to keep the LCS table small
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const n = am.length;
  const m = bm.length;
  const out: DiffLine[] = a.slice(0, pre).map((t) => ({ op: ' ', text: t }));
  if (n * m > 4_000_000) {
    // too large for LCS: show as replace
    for (const t of am) out.push({ op: '-', text: t });
    for (const t of bm) out.push({ op: '+', text: t });
  } else {
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      const row = dp[i] ?? [];
      const below = dp[i + 1] ?? [];
      for (let j = m - 1; j >= 0; j--) {
        row[j] =
          am[i] === bm[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) {
        out.push({ op: ' ', text: am[i] ?? '' });
        i++;
        j++;
      } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
        out.push({ op: '-', text: am[i] ?? '' });
        i++;
      } else {
        out.push({ op: '+', text: bm[j] ?? '' });
        j++;
      }
    }
    while (i < n) out.push({ op: '-', text: am[i++] ?? '' });
    while (j < m) out.push({ op: '+', text: bm[j++] ?? '' });
  }
  for (const t of a.slice(a.length - suf)) out.push({ op: ' ', text: t });
  return out;
}
