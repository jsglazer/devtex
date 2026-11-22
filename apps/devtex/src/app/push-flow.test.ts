import { describe, expect, it } from 'vitest';
import { MemoryFs } from './fakes.test-util.js';
import { pushReview, submitVersion, type PushDeps, type PushDialogs } from './push-flow.js';
import { ProjectSession } from './session.js';
import type { PushRequestEntry } from '../shell/types.js';

const TIME = { year: 2026, month: 11, day: 22, hour: 10, minute: 15, second: 0 };

async function setup(
  files: Record<string, string>,
  over: Partial<PushDialogs> = {},
  pushImpl?: PushDeps['push'],
) {
  const fs = new MemoryFs(files);
  const session = new ProjectSession(
    fs,
    { conflict: () => Promise.resolve('loadDisk'), notice: () => undefined },
    { reloaded: () => undefined, changed: () => undefined },
  );
  await session.load();
  const notices: string[] = [];
  const pushes: { entries: PushRequestEntry[]; message: string; allowUntracked: boolean }[] = [];
  let token = false;
  const dialogs: PushDialogs = {
    repoFolder: (s) => Promise.resolve(s),
    token: () => Promise.resolve('fake-token'),
    approveMessage: (m) => Promise.resolve(m),
    proceedOrAbort: () => Promise.resolve(true),
    confirm: () => Promise.resolve(true),
    notice: (t) => notices.push(t),
    ...over,
  };
  const deps: PushDeps = {
    session,
    dialogs,
    stat: (p) => fs.stat(p),
    hasToken: () => Promise.resolve(token),
    setToken: () => {
      token = true;
      return Promise.resolve();
    },
    push:
      pushImpl ??
      ((entries, message, allowUntracked) => {
        pushes.push({ entries, message, allowUntracked });
        return Promise.resolve({ commitSha: 'abcdef1234', blobShas: {} });
      }),
    localTime: () => TIME,
    vaultRelative: 'Research',
  };
  return { fs, session, deps, notices, pushes };
}

const ROOT = '% !DevTex git = thesis/\n\\begin{document}\n\\input{ch/one}\n\\end{document}';

describe('pushReview', () => {
  it('saves, pushes root + includes (+ PDF) as one commit with the review message, then stamps', async () => {
    const { deps, pushes, fs, session } = await setup({
      'main.tex': ROOT,
      'ch/one.tex': 'One',
      'main.pdf': '%PDF',
    });
    session.setText('ch/one.tex', 'One edited');
    const r = await pushReview(deps, 'main.tex');
    expect(r).toEqual({ ok: true, stamp: '20261122-101500', commitSha: 'abcdef1234' });
    expect(fs.files.get('ch/one.tex')).toBe('One edited');
    expect(pushes).toEqual([
      {
        entries: [
          { localPath: 'main.tex', repoPath: 'thesis/main.tex' },
          { localPath: 'ch/one.tex', repoPath: 'thesis/ch/one.tex' },
          { localPath: 'main.pdf', repoPath: 'thesis/main.pdf' },
        ],
        message: 'Review: main.tex 20261122-101500',
        allowUntracked: false,
      },
    ]);
    expect(fs.files.get('main.tex')).toContain('% !DevTex pushed = 20261122-101500');
  });

  it('prompts for the repo folder (suggesting the vault-relative folder) and records it', async () => {
    let suggested = '';
    const { deps, fs, pushes } = await setup(
      { 'paper/main.tex': '\\begin{document}\\end{document}' },
      { repoFolder: (s) => ((suggested = s), Promise.resolve('reviews/paper')) },
    );
    await pushReview(deps, 'paper/main.tex');
    expect(suggested).toBe('Research/paper/');
    expect(fs.files.get('paper/main.tex')).toContain('% !DevTex git = reviews/paper/');
    expect(pushes[0]?.entries).toEqual([
      { localPath: 'paper/main.tex', repoPath: 'reviews/paper/main.tex' },
    ]);
  });

  it('cancel at the message dialog pushes nothing', async () => {
    const { deps, pushes } = await setup(
      { 'main.tex': ROOT, 'ch/one.tex': '' },
      { approveMessage: () => Promise.resolve(null) },
    );
    expect((await pushReview(deps, 'main.tex')).ok).toBe(false);
    expect(pushes).toEqual([]);
  });

  it('remote-changed refusal is reported and nothing is stamped', async () => {
    const { deps, notices, fs } = await setup({ 'main.tex': ROOT, 'ch/one.tex': '' }, {}, () =>
      Promise.reject({ kind: 'remoteChanged', paths: ['thesis/main.tex'] }),
    );
    const r = await pushReview(deps, 'main.tex');
    expect(r.ok).toBe(false);
    expect(notices.join('\n')).toContain('changed on GitHub since your last push');
    expect(fs.files.get('main.tex')).not.toContain('pushed =');
  });

  it('untracked remote files need confirmation, then retry with allowUntracked', async () => {
    const calls: boolean[] = [];
    const { deps } = await setup({ 'main.tex': ROOT, 'ch/one.tex': '' }, {}, (_e, _m, allow) => {
      calls.push(allow);
      return allow
        ? Promise.resolve({ commitSha: 'c0ffee0', blobShas: {} })
        : Promise.reject({ kind: 'remoteUntracked', paths: ['thesis/main.tex'] });
    });
    expect((await pushReview(deps, 'main.tex')).ok).toBe(true);
    expect(calls).toEqual([false, true]);
  });
});

describe('submitVersion', () => {
  it('aborts with a notice when submitstamp is missing', async () => {
    const { deps, notices, pushes } = await setup({ 'main.tex': ROOT, 'ch/one.tex': '' });
    expect((await submitVersion(deps, 'main.tex')).ok).toBe(false);
    expect(notices[0]).toContain('submitstamp');
    expect(pushes).toEqual([]);
  });

  it('uses "Submitted version {submitstamp}" after Proceed', async () => {
    const { deps, pushes } = await setup({
      'main.tex': `% !DevTex submitstamp = R1\n${ROOT}`,
      'ch/one.tex': '',
    });
    expect((await submitVersion(deps, 'main.tex')).ok).toBe(true);
    expect(pushes[0]?.message).toBe('Submitted version R1');
  });

  it('Abort (the default) pushes nothing', async () => {
    const { deps, pushes } = await setup(
      { 'main.tex': `% !DevTex submitstamp = R1\n${ROOT}`, 'ch/one.tex': '' },
      { proceedOrAbort: () => Promise.resolve(false) },
    );
    expect((await submitVersion(deps, 'main.tex')).ok).toBe(false);
    expect(pushes).toEqual([]);
  });
});
