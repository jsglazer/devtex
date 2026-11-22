import { describe, expect, it } from 'vitest';
import type { ConflictChoice } from '@devtex/core';
import { MemoryFs } from './fakes.test-util.js';
import { ProjectSession, type Prompter } from './session.js';

function setup(files: Record<string, string>, choices: ConflictChoice[] = []) {
  const fs = new MemoryFs(files);
  const notices: string[] = [];
  const conflicts: string[] = [];
  const reloaded: string[] = [];
  const prompter: Prompter = {
    conflict: (path) => {
      conflicts.push(path);
      return Promise.resolve(choices.shift() ?? 'loadDisk');
    },
    notice: (t) => notices.push(t),
  };
  const session = new ProjectSession(fs, prompter, {
    reloaded: (p) => reloaded.push(p),
    changed: () => undefined,
  });
  return { fs, session, notices, conflicts, reloaded };
}

const ROOT = '\\documentclass{article}\n\\begin{document}\n\\input{ch/one}\n\\end{document}';

describe('ProjectSession', () => {
  it('loads files and resolves the root from a chapter', async () => {
    const { session } = setup({
      'main.tex': ROOT,
      'ch/one.tex': '\\section{A}\\label{sec:a}',
      'refs.bib': '@article{k1, title={T}}',
    });
    await session.load();
    expect(session.paths()).toEqual(['ch/one.tex', 'main.tex', 'refs.bib']);
    expect(session.rootFor('ch/one.tex')).toEqual({ root: 'main.tex', source: 'graph' });
    expect(session.labels('main.tex')).toEqual(['sec:a']);
    expect(session.bibEntries().map((e) => e.key)).toEqual(['k1']);
  });

  it('saves through the guarded path and tracks dirtiness', async () => {
    const { session, fs } = setup({ 'main.tex': ROOT });
    await session.load();
    session.setText('main.tex', `${ROOT}\n% edit`);
    expect(session.dirtyPaths()).toEqual(['main.tex']);
    expect(await session.save('main.tex')).toBe('saved');
    expect(fs.files.get('main.tex')).toBe(`${ROOT}\n% edit`);
    expect(session.dirtyPaths()).toEqual([]);
    expect(await session.save('main.tex')).toBe('unchanged');
  });

  it('never overwrites an external edit: save prompts, "load disk" keeps the disk version', async () => {
    const { session, fs, conflicts, reloaded } = setup({ 'main.tex': ROOT }, ['loadDisk']);
    await session.load();
    session.setText('main.tex', 'mine');
    fs.put('main.tex', 'from obsidian');
    expect(await session.save('main.tex')).toBe('loaded-disk');
    expect(conflicts).toEqual(['main.tex']);
    expect(fs.files.get('main.tex')).toBe('from obsidian');
    expect(fs.writes).toEqual([]);
    expect(session.buffers.get('main.tex')?.text).toBe('from obsidian');
    expect(reloaded).toEqual(['main.tex']);
  });

  it('"keep mine" writes only after the explicit choice', async () => {
    const { session, fs } = setup({ 'main.tex': ROOT }, ['keepMine']);
    await session.load();
    session.setText('main.tex', 'mine');
    fs.put('main.tex', 'theirs');
    expect(await session.save('main.tex')).toBe('saved');
    expect(fs.files.get('main.tex')).toBe('mine');
  });

  it('external change with a clean buffer reloads silently', async () => {
    const { session, fs, conflicts, reloaded } = setup({ 'main.tex': ROOT });
    await session.load();
    fs.put('main.tex', 'updated by sync');
    await session.checkExternal(['main.tex']);
    expect(conflicts).toEqual([]);
    expect(reloaded).toEqual(['main.tex']);
    expect(session.buffers.get('main.tex')?.text).toBe('updated by sync');
  });

  it('external change with a dirty buffer prompts and does not write', async () => {
    const { session, fs, conflicts } = setup({ 'main.tex': ROOT }, ['keepMine']);
    await session.load();
    session.setText('main.tex', 'unsaved');
    fs.put('main.tex', 'external');
    await session.checkExternal();
    expect(conflicts).toEqual(['main.tex']);
    expect(fs.writes).toEqual([]);
    expect(session.buffers.get('main.tex')?.text).toBe('unsaved');
    // the next save is the explicit overwrite the user chose
    expect(await session.save('main.tex')).toBe('saved');
    expect(fs.files.get('main.tex')).toBe('unsaved');
  });

  it('same content touched externally is not a change', async () => {
    const { session, fs, reloaded, conflicts } = setup({ 'main.tex': ROOT });
    await session.load();
    session.setText('main.tex', 'dirty');
    fs.put('main.tex', ROOT); // new mtime, same content
    await session.checkExternal(['*']);
    expect(conflicts).toEqual([]);
    expect(reloaded).toEqual([]);
  });

  it('reports deletions and picks up new files', async () => {
    const { session, fs, notices } = setup({ 'main.tex': ROOT, 'old.tex': 'x' });
    await session.load();
    fs.remove('old.tex');
    fs.put('new.tex', 'n');
    await session.checkExternal(['old.tex', 'new.tex']);
    expect(notices[0]).toContain('old.tex was deleted');
    expect(session.buffers.get('new.tex')?.text).toBe('n');
  });
});
