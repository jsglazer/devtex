/** Shell interface the app logic depends on (implemented by tauri.ts, faked in tests). */
import type {
  Engine,
  FileStamp,
  JsonRpcTransport,
  LocalTime,
  ProjectFileSystem,
} from '@devtex/core';

export interface PlatformInfo {
  os: 'macos' | 'ios' | 'other';
  canCompile: boolean;
  canWatch: boolean;
  hasZotero: boolean;
  /** Debug builds only (DEVTEX_OPEN). */
  initialProject?: string | null;
  /** Debug builds only (DEVTEX_RUN): comma-separated command ids. */
  initialCommands?: string | null;
}

export interface ProjectInfo {
  root: string;
  name: string;
  vaultRoot: string | null;
  vaultRelative: string | null;
}

export interface CompileOutcome {
  ok: boolean;
  exitCode: number | null;
  log: string;
  pdf: string | null;
  synctex: string | null;
  outdir: string;
}

export interface PushRequestEntry {
  localPath: string;
  repoPath: string;
}

export interface PushOutcome {
  commitSha: string;
  blobShas: Record<string, string>;
}

/** Serialized AppError from Rust (`kind` is camelCase). */
export interface ShellError {
  kind: string;
  message?: string;
  path?: string;
  paths?: string[];
  disk?: FileStamp | null;
  status?: number;
}

export function errorText(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'kind' in e) {
    const s = e as ShellError;
    switch (s.kind) {
      case 'unauthorized':
        return 'GitHub rejected the token (401). Set a new fine-grained token with Contents: read/write on the papers repo.';
      case 'forbidden':
        return `GitHub refused access (403): ${s.message ?? ''}`;
      case 'githubNotFound':
        return `Repository or branch not found (404): ${s.message ?? ''}`;
      case 'githubConflict':
        return `GitHub conflict (409): ${s.message ?? ''}`;
      case 'unprocessable':
        return `GitHub rejected the update (422): ${s.message ?? ''}`;
      case 'remoteChanged':
        return `Push refused: these files changed on GitHub since your last push:\n${(s.paths ?? []).join('\n')}`;
      case 'noToken':
        return 'No GitHub token in the Keychain.';
      case 'latexmkNotFound':
        return 'latexmk was not found on your login shell PATH. Install TeX Live or set compile.latexmkPath in settings.jsonc.';
      case 'noProject':
        return 'Open a project folder first.';
      default:
        return `${s.kind}: ${s.message ?? s.path ?? ''}`;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

export interface ConfirmOptions {
  title?: string;
  kind?: 'info' | 'warning' | 'error';
  okLabel?: string;
  cancelLabel?: string;
}

export interface Shell {
  fs: ProjectFileSystem;
  bbtTransport: JsonRpcTransport;
  platform(): Promise<PlatformInfo>;
  /** Folder picker: dialog on macOS, UIDocumentPicker + persisted bookmark on iOS. */
  pickFolder(): Promise<string | null>;
  /** iOS cold launch: the vault folder restored from its bookmark (null elsewhere or when none). */
  restoreVault(): Promise<string | null>;
  openProject(path: string): Promise<ProjectInfo>;
  compile(root: string, engine: Engine, latexmkPath: string): Promise<CompileOutcome>;
  cancelCompile(): Promise<void>;
  readSynctex(path: string): Promise<Uint8Array>;
  push(entries: PushRequestEntry[], message: string, allowUntracked: boolean): Promise<PushOutcome>;
  hasToken(): Promise<boolean>;
  setToken(token: string): Promise<void>;
  readConfig(name: string): Promise<string | null>;
  writeConfig(name: string, content: string): Promise<void>;
  listSyntaxFiles(): Promise<string[]>;
  configLocation(): Promise<string>;
  onFsChanged(cb: (paths: string[]) => void): Promise<() => void>;
  onMenu(cb: (command: string) => void): Promise<() => void>;
  confirm(text: string, opts?: ConfirmOptions): Promise<boolean>;
  alert(text: string, title?: string): Promise<void>;
  now(): number;
  localTime(): LocalTime;
}
