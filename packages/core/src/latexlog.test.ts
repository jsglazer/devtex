import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLatexLog } from './latexlog.js';

const LOG = readFileSync(
  join(import.meta.dirname, '..', 'tests', 'fixtures', 'latexlog', 'main.log'),
  'utf8',
);

describe('parseLatexLog (real latexmk -file-line-error log)', () => {
  const entries = parseLatexLog(LOG, '/proj/main.tex');

  it('reports the undefined control sequence in the included file with its line', () => {
    const e = entries.find((x) => x.text.startsWith('Undefined control sequence'));
    expect(e).toMatchObject({ type: 'error', file: '/proj/chapters/broken.tex', line: 2 });
    expect(e?.errorPosText).toContain('\\undefinedcommand');
  });

  it('reports the \\begin/\\end mismatch error', () => {
    const e = entries.find((x) => x.text.includes('ended by'));
    expect(e).toMatchObject({ type: 'error', file: '/proj/chapters/broken.tex', line: 5 });
  });

  it('reports undefined reference and citation as warnings on the root', () => {
    const ref = entries.find((x) => x.text === 'Cannot find reference `sec:missing`.');
    const cit = entries.find((x) => x.text === 'Cannot find citation `nokey`.');
    expect(ref).toMatchObject({ type: 'warning', file: '/proj/main.tex', line: 4 });
    expect(cit).toMatchObject({ type: 'warning', file: '/proj/main.tex', line: 4 });
  });

  it('is deterministic and keeps no state between calls', () => {
    expect(parseLatexLog(LOG, '/proj/main.tex')).toEqual(entries);
  });
});

describe('parseLatexLog (synthetic)', () => {
  it('parses package warnings with continuation lines', () => {
    const log = [
      "Package natbib Warning: Citation `x' on page 2 undefined on input line 7.",
      '',
      '',
    ].join('\n');
    const [e] = parseLatexLog(log, 'main.tex');
    expect(e).toMatchObject({ type: 'warning', line: 7 });
    expect(e?.text).toContain('Package natbib');
  });

  it('tracks the file stack through nested parentheses', () => {
    const log = [
      '(./main.tex (./a.tex',
      'LaTeX Warning: Something odd on input line 3.',
      '',
      ')',
      'LaTeX Warning: Back in main on input line 9.',
      '',
    ].join('\n');
    const es = parseLatexLog(log, '/p/main.tex');
    expect(es[0]).toMatchObject({ file: '/p/a.tex', line: 3 });
    expect(es[1]).toMatchObject({ file: '/p/main.tex', line: 9 });
  });

  it('reports bad boxes only when enabled', () => {
    const log =
      'Overfull \\hbox (12.3pt too wide) in paragraph at lines 10--12\n[]\\OT1/cmr/m/n/10 text\n';
    expect(parseLatexLog(log, 'm.tex')).toHaveLength(0);
    expect(parseLatexLog(log, 'm.tex', { badBoxes: 'both' })[0]).toMatchObject({
      type: 'typesetting',
      line: 10,
    });
  });

  it('handles "! " errors without file:line', () => {
    const [e] = parseLatexLog('! Emergency stop.\n<*> main.tex\n\n', '/p/main.tex');
    expect(e).toMatchObject({
      type: 'error',
      file: '/p/main.tex',
      line: 1,
      text: 'Emergency stop.\n<*> main.tex\n',
    });
  });
});
