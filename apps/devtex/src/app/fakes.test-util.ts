/** In-memory ProjectFileSystem for tests: content-hash stamps, external-edit simulation. */
import {
  hashString,
  type FileStamp,
  type ProjectFileSystem,
  type ReadResult,
  type SaveResult,
} from '@devtex/core';

export class MemoryFs implements ProjectFileSystem {
  readonly files = new Map<string, string>();
  private clock = 1000;
  private mtimes = new Map<string, number>();
  writes: string[] = [];

  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.put(k, v);
  }

  /** Simulates an external writer (Obsidian / Obsidian Sync). */
  put(path: string, text: string): void {
    this.files.set(path, text);
    this.mtimes.set(path, (this.clock += 10));
  }

  remove(path: string): void {
    this.files.delete(path);
    this.mtimes.delete(path);
  }

  private stampOf(path: string): FileStamp | null {
    const t = this.files.get(path);
    if (t === undefined) return null;
    return { mtimeMs: this.mtimes.get(path) ?? 0, hash: hashString(t) };
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.files.keys()].filter((p) => /\.(tex|bib)$/.test(p)).sort());
  }

  read(path: string): Promise<ReadResult> {
    const s = this.stampOf(path);
    const t = this.files.get(path);
    if (s === null || t === undefined) return Promise.reject(new Error(`not found ${path}`));
    return Promise.resolve({ text: t, stamp: s });
  }

  readBytes(path: string): Promise<Uint8Array> {
    return Promise.resolve(new TextEncoder().encode(this.files.get(path) ?? ''));
  }

  stat(path: string): Promise<FileStamp | null> {
    return Promise.resolve(this.stampOf(path));
  }

  saveGuarded(path: string, text: string, expected: FileStamp | null): Promise<SaveResult> {
    const cur = this.stampOf(path);
    const same =
      (expected === null && cur === null) ||
      (expected !== null && cur !== null && expected.hash === cur.hash);
    if (!same) return Promise.resolve({ ok: false, conflict: true, disk: cur });
    this.writes.push(path);
    this.put(path, text);
    const s = this.stampOf(path);
    return Promise.resolve(
      s === null ? { ok: false, conflict: true, disk: null } : { ok: true, stamp: s },
    );
  }
}
