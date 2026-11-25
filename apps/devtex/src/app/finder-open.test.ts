import { describe, expect, it } from 'vitest';
import { planOpen } from './finder-open.js';

describe('planOpen', () => {
  it('opens a folder as the project', () => {
    expect(planOpen({ path: '/u/paper', isDir: true, project: '/u/paper' }, '/u/other')).toEqual({
      project: '/u/paper',
      file: null,
    });
  });

  it('opens a file in the project folder the shell chose', () => {
    expect(
      planOpen({ path: '/u/paper/ch/one.tex', isDir: false, project: '/u/paper' }, null),
    ).toEqual({ project: '/u/paper', file: 'ch/one.tex' });
  });

  it('switches to a file inside the open project without reopening', () => {
    expect(
      planOpen({ path: '/u/big/ch/one.tex', isDir: false, project: '/u/big/ch' }, '/u/big'),
    ).toEqual({ project: null, file: 'ch/one.tex' });
  });

  it('does not treat a sibling folder with a shared prefix as inside the project', () => {
    expect(
      planOpen({ path: '/u/paper2/main.tex', isDir: false, project: '/u/paper2' }, '/u/paper'),
    ).toEqual({ project: '/u/paper2', file: 'main.tex' });
  });
});
