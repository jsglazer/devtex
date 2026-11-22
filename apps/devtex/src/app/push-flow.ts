/**
 * Review push / submit flows (markup-reviewer conventions). DOM-free: the
 * dialogs are injected, so the whole sequence is tested with fakes.
 *
 * Review: save all -> plan (prompt for `% !DevTex git` folder if missing) ->
 * ensure token -> approve/cancel an editable "Review: <root> <stamp>" message
 * -> push (one commit) -> record `% !DevTex pushed = <stamp>` via guarded save.
 * Submit: requires `% !DevTex submitstamp`; Proceed/Abort dialog defaults to
 * Abort; message "Submitted version {submitstamp}".
 */
import {
  dirname,
  formatPushedStamp,
  pdfPathFor,
  planPush,
  reviewCommitMessage,
  submitCommitMessage,
  withPushedStamp,
  withRepoFolder,
  type LocalTime,
} from '@devtex/core';
import type { ProjectSession } from './session.js';
import type { PushOutcome, PushRequestEntry, ShellError } from '../shell/types.js';
import { errorText } from '../shell/types.js';

export interface PushDialogs {
  /** Ask for the repo folder; null = cancel. */
  repoFolder(suggested: string): Promise<string | null>;
  /** Ask for a GitHub token; null = cancel. */
  token(): Promise<string | null>;
  /** Editable message with Approve / Cancel; returns the final message or null. */
  approveMessage(defaultMessage: string, files: string[]): Promise<string | null>;
  /** Proceed / Abort with Abort as the default action. */
  proceedOrAbort(text: string): Promise<boolean>;
  /** Yes/no confirmation. */
  confirm(text: string): Promise<boolean>;
  notice(text: string): void;
}

export interface PushDeps {
  session: ProjectSession;
  dialogs: PushDialogs;
  stat(path: string): Promise<unknown>;
  hasToken(): Promise<boolean>;
  setToken(token: string): Promise<void>;
  push(entries: PushRequestEntry[], message: string, allowUntracked: boolean): Promise<PushOutcome>;
  localTime(): LocalTime;
  /** Vault-relative folder of the project root ('' at the vault root, null outside a vault). */
  vaultRelative: string | null;
}

export type PushResult =
  { ok: true; stamp: string; commitSha: string } | { ok: false; reason: string };

function isShellError(e: unknown, kind: string): e is ShellError {
  return typeof e === 'object' && e !== null && 'kind' in e && (e as ShellError).kind === kind;
}

async function prepare(
  deps: PushDeps,
  root: string,
): Promise<{ entries: PushRequestEntry[] } | { error: string }> {
  const saved = await deps.session.saveAll();
  if ([...saved.values()].some((o) => o === 'cancelled'))
    return { error: 'Save was cancelled; nothing pushed.' };
  const pdf = pdfPathFor(root);
  const pdfExists = (await deps.stat(pdf)) !== null;
  let plan = planPush(
    root,
    deps.session.snapshot(),
    pdfExists ? pdf : null,
    joinVault(deps.vaultRelative, dirname(root)),
  );
  if (!plan.ok) {
    const folder = await deps.dialogs.repoFolder(plan.suggestedFolder);
    if (folder === null) return { error: 'Push cancelled.' };
    const text = deps.session.buffers.get(root)?.text ?? '';
    const w = await deps.session.writeFile(root, withRepoFolder(text, folder));
    if (w !== 'saved') return { error: 'Could not record the repo folder in the root file.' };
    plan = planPush(root, deps.session.snapshot(), pdfExists ? pdf : null, '');
    if (!plan.ok) return { error: 'Repo folder missing.' };
  }
  if (!(await deps.hasToken())) {
    const t = await deps.dialogs.token();
    if (t === null || t.trim() === '') return { error: 'Push cancelled: no GitHub token.' };
    await deps.setToken(t);
  }
  return { entries: plan.entries.map((e) => ({ localPath: e.localPath, repoPath: e.repoPath })) };
}

function joinVault(vaultRel: string | null, dir: string): string {
  const parts = [vaultRel ?? '', dir === '.' ? '' : dir].filter((p) => p !== '');
  return parts.join('/');
}

async function doPush(
  deps: PushDeps,
  root: string,
  entries: PushRequestEntry[],
  message: string,
  stamp: string,
): Promise<PushResult> {
  let outcome: PushOutcome;
  try {
    outcome = await deps.push(entries, message, false);
  } catch (e) {
    if (isShellError(e, 'remoteUntracked')) {
      const ok = await deps.dialogs.confirm(
        `These files already exist in the repo but were not pushed by DevTex on this machine:\n${(e.paths ?? []).join('\n')}\n\nOverwrite them?`,
      );
      if (!ok) return { ok: false, reason: 'Push cancelled.' };
      try {
        outcome = await deps.push(entries, message, true);
      } catch (e2) {
        deps.dialogs.notice(errorText(e2));
        return { ok: false, reason: errorText(e2) };
      }
    } else {
      deps.dialogs.notice(errorText(e));
      return { ok: false, reason: errorText(e) };
    }
  }
  const rootText = deps.session.buffers.get(root)?.text ?? '';
  const w = await deps.session.writeFile(root, withPushedStamp(rootText, stamp));
  if (w !== 'saved')
    deps.dialogs.notice('Pushed, but the pushed stamp could not be written to the root file.');
  deps.dialogs.notice(
    `Pushed ${entries.length} file(s) as one commit (${outcome.commitSha.slice(0, 7)}).`,
  );
  return { ok: true, stamp, commitSha: outcome.commitSha };
}

export async function pushReview(deps: PushDeps, root: string): Promise<PushResult> {
  const prep = await prepare(deps, root);
  if ('error' in prep) {
    deps.dialogs.notice(prep.error);
    return { ok: false, reason: prep.error };
  }
  const stamp = formatPushedStamp(deps.localTime());
  const message = await deps.dialogs.approveMessage(
    reviewCommitMessage(root, stamp),
    prep.entries.map((e) => e.repoPath),
  );
  if (message === null || message.trim() === '') return { ok: false, reason: 'Push cancelled.' };
  return doPush(deps, root, prep.entries, message, stamp);
}

export async function submitVersion(deps: PushDeps, root: string): Promise<PushResult> {
  const sub = submitCommitMessage(deps.session.buffers.get(root)?.text ?? '');
  if (!sub.ok) {
    deps.dialogs.notice(sub.notice);
    return { ok: false, reason: sub.notice };
  }
  const prep = await prepare(deps, root);
  if ('error' in prep) {
    deps.dialogs.notice(prep.error);
    return { ok: false, reason: prep.error };
  }
  const proceed = await deps.dialogs.proceedOrAbort(
    `Push "${sub.message}" (${prep.entries.length} files) to the papers repo?`,
  );
  if (!proceed) return { ok: false, reason: 'Submit aborted.' };
  return doPush(deps, root, prep.entries, sub.message, formatPushedStamp(deps.localTime()));
}
