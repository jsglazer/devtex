/**
 * GitHub review push planning (pure). The Rust core performs the single-commit
 * push through the Git Data API; this module decides WHAT is pushed and the
 * messages, following jsglazer/markup-reviewer conventions:
 *   - repo folder from `% !DevTex git = <folder>/` (prompt with the
 *     vault-relative folder when absent),
 *   - files: root .tex + every \input/\include file + the PDF if built,
 *   - pushed stamp YYYYMMDD-HHMMSS in local time, written back as
 *     `% !DevTex pushed = …` after a successful push,
 *   - review message "Review: <root file name> <stamp>" (editable),
 *   - submit message "Submitted version {submitstamp}" (aborts without it).
 */
import { parseMagicComments, setDevTexMagic } from './magic.js';
import { includeClosure, type FileMap } from './project.js';
import { basename, dirname, joinPath, relativePath } from './text.js';

export const PAPERS_REPO = { owner: 'jsglazer', repo: 'papers', branch: 'main' } as const;
export const TOKEN_KEYCHAIN_NAME = 'github-papers-token';

export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

export function formatPushedStamp(t: LocalTime): string {
  return `${pad(t.year, 4)}${pad(t.month)}${pad(t.day)}-${pad(t.hour)}${pad(t.minute)}${pad(t.second)}`;
}

export interface PushEntry {
  /** Project-relative local path. */
  localPath: string;
  /** Path inside the repo. */
  repoPath: string;
  binary: boolean;
}

export type PushPlan =
  | { ok: true; repoFolder: string; entries: PushEntry[] }
  | { ok: false; needsFolder: true; suggestedFolder: string };

/** Normalize a repo folder: no leading slash, exactly one trailing slash ('' for repo root). */
export function normalizeRepoFolder(folder: string): string {
  const f = folder.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return f === '' ? '' : `${f}/`;
}

/**
 * @param root project-relative root .tex
 * @param files snapshot of project files
 * @param pdfPath project-relative PDF next to the root, or null when not built
 * @param vaultRelativeDir vault-relative folder of the root, used as the suggested repo folder
 */
export function planPush(
  root: string,
  files: FileMap,
  pdfPath: string | null,
  vaultRelativeDir: string,
): PushPlan {
  const magic = parseMagicComments(files.get(root) ?? '');
  if (magic.git === undefined) {
    return { ok: false, needsFolder: true, suggestedFolder: normalizeRepoFolder(vaultRelativeDir) };
  }
  const repoFolder = normalizeRepoFolder(magic.git);
  const rootDir = dirname(root);
  const toRepo = (p: string): string => {
    const rel = relativePath(rootDir, p);
    return `${repoFolder}${rel}`;
  };
  const entries: PushEntry[] = includeClosure(root, files).map((p) => ({
    localPath: p,
    repoPath: toRepo(p),
    binary: false,
  }));
  if (pdfPath !== null)
    entries.push({ localPath: pdfPath, repoPath: toRepo(pdfPath), binary: true });
  // files outside the root folder (../shared.tex) would escape the repo folder
  for (const e of entries) {
    if (e.repoPath.includes('../')) e.repoPath = `${repoFolder}${basename(e.localPath)}`;
  }
  return { ok: true, repoFolder, entries };
}

/** PDF that latexmk output is copied to: next to the root .tex. */
export function pdfPathFor(root: string): string {
  return joinPath(dirname(root), `${basename(root).replace(/\.tex$/i, '')}.pdf`);
}

export function reviewCommitMessage(root: string, stamp: string): string {
  return `Review: ${basename(root)} ${stamp}`;
}

export type SubmitMessage = { ok: true; message: string } | { ok: false; notice: string };

export function submitCommitMessage(rootText: string): SubmitMessage {
  const s = parseMagicComments(rootText).submitstamp;
  if (s === undefined || s.trim() === '') {
    return {
      ok: false,
      notice:
        'Submit aborted: add "% !DevTex submitstamp = <value>" to the top of the root .tex first.',
    };
  }
  return { ok: true, message: `Submitted version ${s}` };
}

/** Root text with the pushed stamp recorded (written via the guarded save). */
export function withPushedStamp(rootText: string, stamp: string): string {
  return setDevTexMagic(rootText, 'pushed', stamp);
}

export function withRepoFolder(rootText: string, folder: string): string {
  return setDevTexMagic(rootText, 'git', normalizeRepoFolder(folder));
}
