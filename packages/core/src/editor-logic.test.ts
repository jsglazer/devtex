import { describe, expect, it } from 'vitest';
import { bibLabel, bibResources, parseBibtex } from './bibtex.js';
import { complete } from './completion.js';
import { PALETTE, splitCursor } from './completion-data.js';
import { diagnose } from './diagnostics.js';
import { collectMacros } from './macros.js';
import { labelsOf, outlineOf } from './outline.js';

const ctx = (text: string) => {
  const pos = text.indexOf('|');
  return {
    text: text.replace('|', ''),
    pos,
    labels: ['sec:intro', 'eq:main', 'fig:a'],
    citations: [{ key: 'angrist2009', label: 'Angrist (2009)' }, { key: 'imbens2015' }],
    macros: collectMacros(['\\newcommand{\\norm}[1]{\\lVert #1\\rVert}']),
  };
};

describe('completion', () => {
  it('completes citekeys after \\cite variants, including after a comma', () => {
    const r = complete(ctx('see \\citep[p.~2]{angrist2009, im|'));
    expect(r?.options.map((o) => o.label)).toEqual(['imbens2015']);
    expect(r?.from).toBe('see \\citep[p.~2]{angrist2009, '.length);
  });

  it('completes labels after \\ref', () => {
    const r = complete(ctx('\\eqref{eq|'));
    expect(r?.options.map((o) => o.label)).toEqual(['eq:main']);
  });

  it('completes environments after \\begin{ and suggests the open env after \\end{', () => {
    const r = complete(ctx('\\begin{ite|'));
    expect(r?.options[0]?.label).toBe('itemize');
    expect(r?.options[0]?.apply).toContain('\\item |');
    const e = complete({ ...ctx('\\end{|'), openEnv: 'align' });
    expect(e?.options[0]?.label).toBe('align');
  });

  it('completes commands including user macros with argument slots', () => {
    const r = complete(ctx('x \\no|'));
    const labels = r?.options.map((o) => o.label) ?? [];
    expect(labels).toContain('\\norm');
    expect(labels).toContain('\\noindent');
    expect(r?.options.find((o) => o.label === '\\norm')?.apply).toBe('\\norm{|}');
    expect(r?.from).toBe(2);
  });

  it('returns null with nothing to complete', () => {
    expect(complete(ctx('plain |'))).toBeNull();
  });
});

describe('grouped palette', () => {
  it('has sectioning, environments, size and alignment groups', () => {
    expect(PALETTE.map((g) => g.id)).toEqual(['sectioning', 'environments', 'size', 'alignment']);
    expect(PALETTE[0]?.items.map((i) => i.label)).toEqual([
      '\\part',
      '\\chapter',
      '\\section',
      '\\subsection',
      '\\subsubsection',
      '\\paragraph',
      '\\subparagraph',
    ]);
    expect(PALETTE[2]?.items.map((i) => i.label)[0]).toBe('\\tiny');
    expect(PALETTE[2]?.items.map((i) => i.label).at(-1)).toBe('\\Huge');
    expect(PALETTE[3]?.items.map((i) => i.label)).toEqual([
      'center',
      'flushleft',
      'flushright',
      '\\centering',
      '\\raggedright',
      '\\raggedleft',
    ]);
    expect(splitCursor('\\section{|}')).toEqual({ text: '\\section{}', cursor: 9 });
  });
});

describe('diagnostics', () => {
  it('flags undefined refs, unknown citekeys and structure problems with offsets', () => {
    const text = '\\ref{sec:intro,sec:nope} \\cite{angrist2009, zzz} \\begin{itemize}';
    const d = diagnose(text, {
      labels: new Set(['sec:intro']),
      citekeys: new Set(['angrist2009']),
    });
    expect(d.map((x) => x.message)).toEqual([
      'Undefined reference: sec:nope',
      'Unknown citekey: zzz',
      '\\begin{itemize} is not closed',
    ]);
    const nope = d[0];
    expect(text.slice(nope?.from, nope?.to)).toBe('sec:nope');
    const zzz = d[1];
    expect(text.slice(zzz?.from, zzz?.to)).toBe('zzz');
  });

  it('skips the citekey check when no citation source is available', () => {
    expect(diagnose('\\cite{x}', { labels: new Set(), citekeys: null })).toEqual([]);
  });

  it('ignores refs inside comments', () => {
    expect(diagnose('% \\ref{nope}', { labels: new Set(), citekeys: null })).toEqual([]);
  });
});

describe('outline', () => {
  it('lists sections, figures (with caption), tables and labels with lines', () => {
    const t =
      '\\section{Intro}\\label{sec:i}\ntext\n\\subsection*{Data \\& Methods}\n\\begin{figure}\n\\caption{A plot}\n\\end{figure}\n% \\section{commented}\n\\begin{table}\n\\end{table}';
    const o = outlineOf('a.tex', t);
    expect(o.map((i) => [i.kind, i.level, i.title, i.line])).toEqual([
      ['section', 2, 'Intro', 1],
      ['label', 7, 'sec:i', 1],
      ['section', 3, 'Data \\& Methods', 3],
      ['figure', 7, 'A plot', 4],
      ['table', 7, 'Table', 8],
    ]);
    expect(labelsOf(o)).toEqual(['sec:i']);
  });

  it('lists Beamer frames under their section, with titles from any form', () => {
    const t = [
      '\\frame{\\titlepage}',
      '\\section{Intro}',
      '\\begin{frame}<1->[fragile]{Landscape}',
      '\\end{frame}',
      '\\begin{frame}',
      '\\frametitle{Theory \\& Hypothesis}',
      '\\end{frame}',
      '\\subsection{Detail}',
      '\\begin{frame}[plain]',
      '\\end{frame}',
    ].join('\n');
    const o = outlineOf('a.tex', t);
    expect(o.map((i) => [i.kind, i.level, i.title, i.line])).toEqual([
      ['frame', 2, 'Title page', 1],
      ['section', 2, 'Intro', 2],
      ['frame', 3, 'Landscape', 3],
      ['frame', 3, 'Theory \\& Hypothesis', 5],
      ['section', 3, 'Detail', 8],
      ['frame', 4, 'Frame', 9],
    ]);
  });
});

describe('bibtex', () => {
  it('parses entries, skipping @comment/@string and tolerating junk', () => {
    const bib = `@comment{ignored}
@string{jn = "Journal"}
@article{angrist2009,
  author = {Angrist, Joshua D. and Pischke, J{\\"o}rn-Steffen},
  title = {Mostly {Harmless} Econometrics},
  year = 2009,
  journal = jn # " of Things"
}
@book(imbens2015, title = "Causal Inference", date = {2015-04-01})
garbage @ here
@misc{broken
@inproceedings{last, title={Last}}`;
    const es = parseBibtex(bib);
    expect(es.map((e) => e.key)).toEqual(['angrist2009', 'imbens2015', 'last']);
    expect(es[0]?.fields['title']).toBe('Mostly Harmless Econometrics');
    expect(es[0]?.fields['year']).toBe('2009');
    expect(bibLabel(es[0] ?? { key: '', type: '', fields: {} })).toBe(
      'Angrist (2009) Mostly Harmless Econometrics',
    );
    expect(bibLabel(es[1] ?? { key: '', type: '', fields: {} })).toBe('(2015) Causal Inference');
  });

  it('finds bibliography resources', () => {
    expect(bibResources('\\bibliography{refs,more.bib}\\addbibresource[x]{other.bib}')).toEqual([
      'refs.bib',
      'more.bib',
      'other.bib',
    ]);
  });
});
