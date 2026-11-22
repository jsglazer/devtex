/**
 * Injectable OS-service interfaces. Core logic never performs I/O; the Tauri
 * shell (apps/devtex/src/shell) implements these over Rust commands, and
 * tests implement them in memory.
 */
import type { FileStamp } from './conflict.js';
import type { LogEntry } from './latexlog.js';
import type { Engine } from './magic.js';

export interface ReadResult {
  text: string;
  stamp: FileStamp;
}

export type SaveResult =
  { ok: true; stamp: FileStamp } | { ok: false; conflict: true; disk: FileStamp | null };

export interface ProjectFileSystem {
  /** Project-relative paths of .tex and .bib files. */
  list(): Promise<string[]>;
  read(path: string): Promise<ReadResult>;
  readBytes(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<FileStamp | null>;
  /**
   * Write `text` only if the file on disk still matches `expected` (mtime +
   * content hash); `expected` null means "must not exist yet".
   */
  saveGuarded(path: string, text: string, expected: FileStamp | null): Promise<SaveResult>;
}

export interface CompileRequest {
  root: string;
  engine: Engine;
}

export interface CompileResult {
  ok: boolean;
  log: string;
  entries: LogEntry[];
  /** Project-relative PDF next to the root, when produced. */
  pdf: string | null;
  /** Absolute path of the .synctex.gz in the cache dir, when produced. */
  synctex: string | null;
}

export interface Compiler {
  compile(req: CompileRequest): Promise<CompileResult>;
  cancel(): Promise<void>;
}

export interface Clock {
  now(): number;
  localTime(): import('./push.js').LocalTime;
}
