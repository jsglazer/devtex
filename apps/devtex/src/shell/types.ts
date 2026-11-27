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

/** A Finder open request (double-click, Open With, Dock drop), queued by the Rust side. */
export interface OpenRequest {
  /** Canonical absolute path (same form as `ProjectInfo.root`). */
  path: string;
  isDir: boolean;
  /** Folder to open as the project (for a subfile, the folder of its main document). */
  project: string;
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

/** Raw access to DevStyle's shared folder; wrapped into a `FolderHost` by the app. */
export interface DevStyleFolder {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  /** Where the folder is, for the Settings dialog. */
  location(): Promise<string>;
  /** Something in the folder changed (another app, or an edit by hand). */
  onChanged(cb: () => void): Promise<() => void>;
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
  /** Cached SyncTeX path for the root's existing PDF (from an earlier compile), or null. */
  cachedSynctex(root: string): Promise<string | null>;
  push(entries: PushRequestEntry[], message: string, allowUntracked: boolean): Promise<PushOutcome>;
  hasToken(): Promise<boolean>;
  setToken(token: string): Promise<void>;
  readConfig(name: string): Promise<string | null>;
  writeConfig(name: string, content: string): Promise<void>;
  listSyntaxFiles(): Promise<string[]>;
  /** user.css and any DevTex 1.0.5–1.0.6 profiles: `themes/<name>.css`. */
  listThemeFiles(): Promise<string[]>;
  /** Delete a DevTex 1.0.5–1.0.6 profile (`themes/<name>.css`, never user.css) once migrated. */
  deleteThemeFile(name: string): Promise<void>;
  /**
   * DevStyle's shared folder (macOS App Group container), as paths relative to
   * it: `devstyle.json` and `profiles/<id>.css` only. Null where there is none (iOS).
   */
  devstyleFolder(): Promise<DevStyleFolder | null>;
  configLocation(): Promise<string>;
  /** Show the config folder in Finder (macOS). */
  openConfigFolder(): Promise<void>;
  /** The system light/dark setting, ignoring any appearance forced on the window (null when unknown). */
  systemAppearance(): Promise<'light' | 'dark' | null>;
  /** Force the native window appearance (title bar, scroll bars, controls); null follows the system. */
  setWindowAppearance(appearance: 'light' | 'dark' | null): Promise<void>;
  /** user.css was saved (macOS watcher): `themes/<name>.css` names. */
  onThemeChanged(cb: (names: string[]) => void): Promise<() => void>;
  /** Check View ▸ Style Profile ▸ `family` (e.g. "Paper"); "" unchecks all. No-op without an app menu. */
  setStyleProfileCheck(family: string): Promise<void>;
  /** File ▸ Open File…: native multi-file picker (macOS); null when unsupported. */
  pickFiles(): Promise<string[] | null>;
  /** Open requests (project folder + file) for paths picked in Open File…. */
  resolveOpenPaths(paths: string[]): Promise<OpenRequest[]>;
  onFsChanged(cb: (paths: string[]) => void): Promise<() => void>;
  onMenu(cb: (command: string) => void): Promise<() => void>;
  /** Finder handed over files/folders; call `takeOpenedPaths` to get them. */
  onOpenFiles(cb: () => void): Promise<() => void>;
  /** Drain Finder open requests queued by the shell (macOS; empty elsewhere). */
  takeOpenedPaths(): Promise<OpenRequest[]>;
  confirm(text: string, opts?: ConfirmOptions): Promise<boolean>;
  alert(text: string, title?: string): Promise<void>;
  /** Zoom the whole webview (interface zoom). */
  setZoom(factor: number): Promise<void>;
  now(): number;
  localTime(): LocalTime;
}
