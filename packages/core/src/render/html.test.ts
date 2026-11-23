import { describe, expect, it } from 'vitest';
import { splitBlocks } from '../blocks.js';
import { collectMacros, collectTitleMeta } from '../macros.js';
import { IncrementalRenderer, materializeLines } from './incremental.js';
import {
  columnWidth,
  makeParser,
  MATH_CLOSE,
  MATH_OPEN,
  parseColumnSpec,
  renderBlockTemplate,
} from './html.js';
import type { MathRenderer } from './mathjax.js';
import { MathJaxRenderer } from './mathjax.js';

/** Deterministic fake math renderer: records calls. */
class FakeMath implements MathRenderer {
  calls: string[] = [];
  setMacros(): void {}
  render(tex: string, display: boolean): string {
    this.calls.push(tex);
    return `<m${display ? 'd' : 'i'}>${tex}</m>`;
  }
}

function render(src: string, preamble = ''): string {
  const macros = collectMacros([preamble]);
  const [block] = splitBlocks('a.tex', src);
  if (!block) throw new Error('no block');
  const t = renderBlockTemplate(block, macros, makeParser(macros));
  const math = new FakeMath();
  const filled = t.html.replace(
    new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'),
    (_m, d: string) => {
      const j = t.math[Number(d)];
      return j ? math.render(j.tex, j.display) : '';
    },
  );
  return materializeLines(filled, block.startLine);
}

describe('renderBlockTemplate', () => {
  it('renders prose with emphasis, citations and refs', () => {
    const h = render('Hello \\textbf{bold} and \\emph{it} \\citep[p.~3]{a, b} see \\ref{sec:x}.');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>it</em>');
    expect(h).toContain('data-keys="a,b"');
    expect(h).toContain('[a, b, p.~3]');
    expect(h).toContain('data-label="sec:x"');
  });

  it('renders sectioning with a source line', () => {
    const h = render('\n\n\\subsection*{Intro}');
    expect(h).toMatch(
      /<h3 class="dt-heading dt-subsection dt-starred" data-source-line="3">Intro<\/h3>/,
    );
  });

  it('renders lists with per-item source lines', () => {
    const h = render('\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}');
    expect(h).toContain('<ul class="dt-list" data-source-line="1">');
    expect(h).toContain('<li data-source-line="2">');
    expect(h).toContain('<li data-source-line="3">');
  });

  it('renders tabular rows and alignments', () => {
    const h = render('\\begin{tabular}{l|r}\n a & b \\\\\n \\hline\n c & d \\\\\n\\end{tabular}');
    expect(h).toContain('<table class="dt-tabular"');
    expect(h).toContain('<td style="text-align:left">a</td><td style="text-align:right">b</td>');
    expect(h).toContain('<td style="text-align:left">c</td>');
    expect(parseColumnSpec('p{3cm}|c@{}r')).toEqual([undefined, 'center', 'right']);
  });

  it('sends inline, display and environment math to the math renderer', () => {
    const h = render('Inline $x^2$ and \\(y\\) then');
    expect(h).toContain('<mi>x^2</m>');
    expect(h).toContain('<mi>y</m>');
    expect(render('\\begin{align}\n a &= b\n\\end{align}')).toContain(
      '<md>\\begin{align}\n a &= b\n\\end{align}</m>',
    );
  });

  it('expands user text macros and passes math macros through', () => {
    const h = render(
      'We use \\iid{} data and \\est.',
      '\\def\\iid{i.i.d.}\\newcommand{\\est}{$\\hat\\beta$}',
    );
    expect(h).toContain('i.i.d.');
    expect(h).toContain('<mi>\\hat\\beta</m>');
  });

  it('renders unknown macros and TikZ as labelled placeholders with the source line', () => {
    const h = render('\n\\begin{tikzpicture}\n\\draw (0,0);\n\\end{tikzpicture}');
    expect(h).toContain('[unsupported environment: tikzpicture]');
    expect(h).toContain('(line 2)');
    const u = render('Text \\weirdmacro{x} end');
    expect(u).toContain('class="dt-unsupported"');
    expect(u).toContain('\\weirdmacro');
  });

  it('escapes HTML in prose and handles accents and dashes', () => {
    const h = render("a <b> & c -- d --- e \\'e ``q''");
    expect(h).toContain('a &lt;b&gt;');
    expect(h).toContain('–');
    expect(h).toContain('—');
    expect(h).toContain('é');
    expect(h).toContain('“q”');
  });
});

describe('IncrementalRenderer', () => {
  it('caches by content and defers math beyond the initial budget', () => {
    const math = new FakeMath();
    const r = new IncrementalRenderer({ math, now: () => 0 }, { initialTypesetBlocks: 1 });
    const files = new Map([['m.tex', '\\begin{document}\nA $a$.\n\nB $b$.\n\\end{document}']]);
    const up = r.update({ root: 'm.tex', files });
    expect(up.order).toHaveLength(2);
    expect(math.calls).toEqual(['a']);
    expect(r.pendingIds()).toHaveLength(1);
    const filled = r.typesetPending(r.pendingIds());
    expect(filled[0]?.html).toContain('<mi>b</m>');
    const again = r.update({ root: 'm.tex', files });
    expect(again.changes).toHaveLength(0);
    expect(again.stats.rerendered).toBe(0);
  });

  it('a math failure becomes an error placeholder, not a preview failure', () => {
    const math: MathRenderer = {
      setMacros: () => undefined,
      render: () => {
        throw new Error('boom');
      },
    };
    const r = new IncrementalRenderer({ math, now: () => 0 });
    const files = new Map([['m.tex', 'Fine.\n\nAlso $x$.']]);
    expect(() => r.update({ root: 'm.tex', files })).not.toThrow();
    const html = r
      .snapshot()
      .map((b) => b.html)
      .join('');
    expect(html).toContain('Fine.');
    expect(html).toContain('<span class="dt-math-error" title="boom">x</span>');
  });

  it('missing include target renders a placeholder; cycles terminate', () => {
    const r = new IncrementalRenderer({ math: new FakeMath(), now: () => 0 });
    const files = new Map([
      ['m.tex', '\\begin{document}\n\\input{a}\n\\input{missing}\n\\end{document}'],
      ['a.tex', 'In A.\n\\input{m}\n'],
    ]);
    r.update({ root: 'm.tex', files });
    const html = r
      .snapshot()
      .map((b) => b.html)
      .join('');
    expect(html).toContain('In A.');
    expect(html).toContain('[\\input{missing}]');
  });

  it('real MathJax produces SVG and reports errors inline', () => {
    const mj = new MathJaxRenderer();
    mj.setMacros(collectMacros(['\\newcommand{\\R}{\\mathbb{R}}']));
    expect(mj.render('x \\in \\R', false)).toContain('<svg');
    expect(mj.render('\\frac{a}{b', true)).toContain('dt-math-error');
  });
});

describe('beamer', () => {
  it('renders a frame as a slide with title, subtitle and overlays stripped', () => {
    const h = render(
      '\\begin{frame}<2>[fragile]{Intro}{Why}\n\\begin{itemize}\n\\item<1-> First $x$\n\\item<2-> Second \\pause\n\\end{itemize}\n\\only<2>{shown} \\alert<3>{hot} \\onslide<2->\n\\end{frame}',
    );
    expect(h).toContain('<section class="dt-frame"');
    expect(h).toContain('<div class="dt-frame-title" data-source-line="1">Intro</div>');
    expect(h).toContain('<div class="dt-frame-subtitle">Why</div>');
    expect(h).toContain('First');
    expect(h).toContain('Second');
    expect(h).toContain('shown');
    expect(h).toContain('<span class="dt-alert">hot</span>');
    expect(h).not.toContain('dt-unsupported');
    expect(h).not.toContain('&lt;');
  });

  it('renders \\frametitle, \\frame{\\titlepage}, blocks and columns', () => {
    const f = render(
      '\\begin{frame}\n\\frametitle{Results}\n\\begin{block}{Key}\nbody\n\\end{block}\n\\begin{columns}\n\\column{0.4\\textwidth} Left\n\\column{.6\\linewidth} Right\n\\end{columns}\n\\begin{columns}\n\\begin{column}{0.5\\textwidth} A \\end{column}\n\\begin{column}{0.5\\textwidth} B \\end{column}\n\\end{columns}\n\\end{frame}',
    );
    expect(f).toContain('<div class="dt-frame-title" data-source-line="2">Results</div>');
    expect(f).toContain('dt-beamer-block dt-block');
    expect(f).toContain('<div class="dt-beamer-block-title">Key</div>');
    expect(f).toContain('<div class="dt-columns"');
    expect(f).toContain('style="flex:0 1 40.0%"');
    expect(f).toContain('style="flex:0 1 60.0%"');
    expect(f).toMatch(/Left\s*<\/div><div class="dt-column"/);
    expect(f.match(/style="flex:0 1 50.0%"/g)).toHaveLength(2);
    expect(f).not.toContain('dt-unsupported');
    const t = render('\\frame{\\titlepage}');
    expect(t).toContain('<section class="dt-frame"');
    expect(t).toContain('dt-titlepage');
    expect(t).not.toContain('dt-unsupported');
  });

  it('renders \\titlepage and \\maketitle from the collected title fields', () => {
    const [block] = splitBlocks('a.tex', '\\begin{frame}[plain]\n\\titlepage\n\\end{frame}');
    if (!block) throw new Error('no block');
    const macros = collectMacros([]);
    const meta = collectTitleMeta([
      '\\title[Short]{State Polarization}\\subtitle{Why}\\author{A \\and B}\\institute{Uni}\\date{2026}',
    ]);
    const h = renderBlockTemplate(block, macros, makeParser(macros), undefined, meta).html;
    expect(h).toContain('<div class="dt-tp-title">State Polarization</div>');
    expect(h).toContain('<div class="dt-tp-subtitle">Why</div>');
    expect(h).toMatch(/<div class="dt-tp-author">A\s*<span class="dt-tp-and"><\/span>\s*B<\/div>/);
    expect(h).toContain('<div class="dt-tp-institute">Uni</div>');
    expect(h).toContain('<div class="dt-tp-date">2026</div>');
    expect(h).not.toContain('dt-unsupported');
    expect(render('\\title{X}\\maketitle')).toContain('dt-titlepage');
  });

  it('columnWidth handles relative widths only', () => {
    expect(columnWidth('0.5\\textwidth')).toBe('50.0%');
    expect(columnWidth('.3\\linewidth')).toBe('30.0%');
    expect(columnWidth('40%')).toBe('40.0%');
    expect(columnWidth('5cm')).toBeNull();
  });
});
