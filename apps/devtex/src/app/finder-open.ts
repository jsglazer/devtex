/**
 * Finder open requests (double-click, Open With, drop on the Dock icon).
 * Pure planning: which project folder to open and which file to select.
 */
import type { OpenRequest } from '../shell/types.js';

export interface OpenPlan {
  /** Folder to open as the project, or null to stay in the current project. */
  project: string | null;
  /** Project-relative file to select, or null for the project's default file. */
  file: string | null;
}

function relativeTo(root: string, path: string): string | null {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/**
 * A folder opens as the project. A file inside the open project just switches
 * to it; any other file opens the project folder the shell chose for it.
 */
export function planOpen(req: OpenRequest, currentRoot: string | null): OpenPlan {
  if (req.isDir) return { project: req.path, file: null };
  const inCurrent = currentRoot === null ? null : relativeTo(currentRoot, req.path);
  if (inCurrent !== null) return { project: null, file: inCurrent };
  return { project: req.project, file: relativeTo(req.project, req.path) };
}
