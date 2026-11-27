/**
 * The Tauri shell: implements @devtex/core ports over Rust commands. This is
 * the only module that imports @tauri-apps/*; everything else receives a
 * `Shell` object, so app logic is testable with in-memory fakes.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, message, open } from '@tauri-apps/plugin-dialog';
import type {
  FileStamp,
  JsonRpcTransport,
  ProjectFileSystem,
  ReadResult,
  SaveResult,
} from '@devtex/core';
import type {
  Shell,
  OpenRequest,
  PlatformInfo,
  ProjectInfo,
  CompileOutcome,
  PushOutcome,
  PushRequestEntry,
  ShellError,
} from './types.js';

/** Error carrying the serialized Rust AppError fields (kind, message, paths …). */
export class ShellException extends Error implements ShellError {
  kind: string;
  path?: string;
  paths?: string[];
  disk?: FileStamp | null;
  status?: number;
  constructor(data: ShellError) {
    super(data.message ?? data.kind);
    this.kind = data.kind;
    Object.assign(this, data);
  }
}

function asShellError(e: unknown): ShellException {
  if (e instanceof ShellException) return e;
  if (typeof e === 'object' && e !== null && 'kind' in e)
    return new ShellException(e as ShellError);
  return new ShellException({ kind: 'io', message: String(e) });
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw asShellError(e);
  }
}

let platformPromise: Promise<PlatformInfo> | null = null;
function platformInfo(): Promise<PlatformInfo> {
  platformPromise ??= call<PlatformInfo>('platform');
  return platformPromise;
}

const fs: ProjectFileSystem = {
  list: () => call<string[]>('list_files'),
  read: (path) => call<ReadResult>('read_file', { path }),
  readBytes: async (path) => new Uint8Array(await call<ArrayBuffer>('read_bytes', { path })),
  stat: (path) => call<FileStamp | null>('stat_file', { path }),
  saveGuarded: async (path, text, expected): Promise<SaveResult> => {
    try {
      const stamp = await call<FileStamp>('save_file', { path, text, expected });
      return { ok: true, stamp };
    } catch (e) {
      const err = asShellError(e);
      if (err.kind === 'conflict') return { ok: false, conflict: true, disk: err.disk ?? null };
      throw err;
    }
  },
};

const bbtTransport: JsonRpcTransport = {
  post: (body) => call<string>('bbt_rpc', { body }),
};

export const tauriShell: Shell = {
  fs,
  bbtTransport,
  platform: () => platformInfo(),
  pickFolder: async () => {
    if ((await platformInfo()).os === 'ios') {
      const r = await call<{ path: string | null }>('plugin:ios-bookmarks|pick_folder');
      return r.path;
    }
    const r = await open({
      directory: true,
      multiple: false,
      title: 'Open a project folder (inside your Obsidian vault)',
    });
    return typeof r === 'string' ? r : null;
  },
  restoreVault: async () => {
    if ((await platformInfo()).os !== 'ios') return null;
    const r = await call<{ path: string | null }>('plugin:ios-bookmarks|restore_vault');
    return r.path;
  },
  openProject: (path) => call<ProjectInfo>('open_project', { path }),
  compile: (root, engine, latexmkPath) =>
    call<CompileOutcome>('compile', {
      root,
      engine,
      latexmkPath: latexmkPath === '' ? null : latexmkPath,
    }),
  cancelCompile: () => call<void>('cancel_compile'),
  readSynctex: async (path) => new Uint8Array(await call<ArrayBuffer>('read_synctex', { path })),
  cachedSynctex: async (root) =>
    (await platformInfo()).os === 'macos' ? call<string | null>('cached_synctex', { root }) : null,
  push: (entries: PushRequestEntry[], msg: string, allowUntracked: boolean) =>
    call<PushOutcome>('push_review', { entries, message: msg, allowUntracked }),
  hasToken: () => call<boolean>('has_token'),
  setToken: (token) => call<void>('set_token', { token }),
  readConfig: (name) => call<string | null>('read_config', { name }),
  writeConfig: (name, content) => call<void>('write_config', { name, content }),
  listSyntaxFiles: () => call<string[]>('list_syntax_files'),
  listThemeFiles: () => call<string[]>('list_theme_files'),
  deleteThemeFile: (name) => call<void>('delete_theme_file', { name }),
  devstyleFolder: async () =>
    (await platformInfo()).os !== 'macos'
      ? null
      : {
          read: (path) => call<string | null>('devstyle_read', { path }),
          write: (path, text) => call<void>('devstyle_write', { path, text }),
          list: (dir) => call<string[]>('devstyle_list', { dir }),
          location: () => call<string>('devstyle_location'),
          onChanged: (cb) => listen('devtex://devstyle-changed', () => cb()),
        },
  configLocation: () => call<string>('config_location'),
  openConfigFolder: () => call<void>('open_config_folder'),
  systemAppearance: async () => {
    const a = await call<string | null>('system_appearance').catch(() => null);
    return a === 'dark' || a === 'light' ? a : null;
  },
  setWindowAppearance: async (appearance) => {
    try {
      await getCurrentWindow().setTheme(appearance);
    } catch {
      // platform without a native window theme (iOS): CSS color-scheme still applies
    }
  },
  onThemeChanged: (cb) => listen<string[]>('devtex://theme-changed', (e) => cb(e.payload)),
  setStyleProfileCheck: async (family) => {
    if ((await platformInfo()).os === 'macos')
      await call<void>('set_style_profile_check', { family });
  },
  pickFiles: async () => {
    if ((await platformInfo()).os !== 'macos') return null;
    const r = await open({
      directory: false,
      multiple: true,
      title: 'Open LaTeX files',
      filters: [{ name: 'LaTeX', extensions: ['tex', 'bib', 'sty', 'cls'] }],
    });
    if (r === null) return [];
    return Array.isArray(r) ? r : [r];
  },
  resolveOpenPaths: (paths) => call<OpenRequest[]>('resolve_open_paths', { paths }),
  onFsChanged: (cb) => listen<string[]>('devtex://fs-changed', (e) => cb(e.payload)),
  onMenu: (cb) => listen<string>('devtex://menu', (e) => cb(e.payload)),
  onOpenFiles: (cb) => listen('devtex://open-files', () => cb()),
  takeOpenedPaths: async () =>
    (await platformInfo()).os === 'macos' ? call<OpenRequest[]>('take_opened_paths') : [],
  confirm: (text, opts) =>
    ask(text, {
      title: opts?.title ?? 'DevTex',
      kind: opts?.kind ?? 'info',
      okLabel: opts?.okLabel ?? 'OK',
      cancelLabel: opts?.cancelLabel ?? 'Cancel',
    }),
  alert: async (text, title) => {
    await message(text, { title: title ?? 'DevTex' });
  },
  setZoom: async (factor) => {
    try {
      await getCurrentWebview().setZoom(factor);
    } catch {
      // platform without native webview zoom: fall back to CSS zoom
      document.documentElement.style.setProperty('zoom', String(factor));
    }
  },
  now: () => performance.now(),
  localTime: () => {
    const d = new Date();
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  },
};

export type { UnlistenFn };
