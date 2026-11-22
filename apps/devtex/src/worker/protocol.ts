/** Messages between the UI thread and the preview Web Worker. */
import type { BlockUpdate, RenderUpdate } from '@devtex/core/render';

export type ToWorker =
  /** Full or partial file contents (only changed files are sent after the first load). */
  | { type: 'files'; root: string; files: [string, string][]; removed?: string[] }
  /** Block ids currently visible in the preview: typeset their deferred math. */
  | { type: 'visible'; ids: string[] }
  | { type: 'reset' };

export type FromWorker =
  | { type: 'rendered'; seq: number; update: RenderUpdate }
  | { type: 'typeset'; changes: BlockUpdate[] }
  | { type: 'error'; message: string };
