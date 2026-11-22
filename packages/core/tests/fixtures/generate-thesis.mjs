// Regenerates the fixed performance fixture in ./thesis (deterministic: no
// randomness, no clock). The generated files are committed; tests read them.
// Usage: node packages/core/tests/fixtures/generate-thesis.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'thesis');
mkdirSync(join(out, 'chapters'), { recursive: true });

const words =
  'the model estimates a causal effect under weak identification assumptions while the sample varies across regions and periods with robust standard errors'.split(
    ' ',
  );
const sentence = (seed, n) => {
  const w = [];
  for (let i = 0; i < n; i++) w.push(words[(seed * 7 + i * 3) % words.length]);
  const s = w.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
};

const CHAPTERS = 8;
const root = [
  '% !TEX program = pdflatex',
  '% !DevTex git = thesis/',
  '\\documentclass[12pt]{report}',
  '\\usepackage{amsmath,amssymb,booktabs,graphicx,natbib,tikz}',
  '\\newcommand{\\R}{\\mathbb{R}}',
  '\\newcommand{\\E}{\\mathbb{E}}',
  '\\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}',
  '\\newcommand{\\estimator}{$\\hat{\\beta}$}',
  '\\DeclareMathOperator{\\Var}{Var}',
  '\\DeclareMathOperator*{\\argmin}{arg\\,min}',
  '\\def\\iid{i.i.d.}',
  '\\title{A Fixture Dissertation}',
  '\\author{Test Author}',
  '\\begin{document}',
  '\\maketitle',
  '\\tableofcontents',
  '',
  ...Array.from({ length: CHAPTERS }, (_, i) => `\\include{chapters/ch${i + 1}}`),
  '',
  '\\bibliographystyle{plainnat}',
  '\\bibliography{refs}',
  '\\end{document}',
  '',
];
writeFileSync(join(out, 'main.tex'), root.join('\n'));

for (let c = 1; c <= CHAPTERS; c++) {
  const L = [];
  L.push(`\\chapter{Chapter ${c}}\\label{ch:${c}}`, '');
  for (let s = 1; s <= 8; s++) {
    L.push(`\\section{Section ${c}.${s}}\\label{sec:${c}-${s}}`, '');
    for (let p = 0; p < 3; p++) {
      const seed = c * 100 + s * 10 + p;
      L.push(
        `${sentence(seed, 14)} We write $x_{${p}} \\in \\R^{${s}}$ and cite \\citep{key${seed % 17}}.`,
      );
      L.push(
        `${sentence(seed + 1, 12)} The \\estimator{} is \\emph{consistent} when $\\E[u_i \\mid x_i] = 0$, see Section~\\ref{sec:${c}-${s}}.`,
      );
      L.push(`${sentence(seed + 2, 16)} % a trailing comment`);
      L.push(`${sentence(seed + 3, 10)} Errors are \\iid{} with $\\Var(u) = \\sigma^2$.`);
      L.push('');
    }
    L.push('\\begin{equation}\\label{eq:' + c + '-' + s + '}');
    L.push(
      `  \\hat{\\beta}_{${s}} = \\argmin_{b \\in \\R^k} \\norm{y - X b}^2 + \\lambda_{${c}} \\norm{b}`,
    );
    L.push('\\end{equation}', '');
    L.push('\\begin{itemize}');
    for (let k = 0; k < 4; k++) L.push(`  \\item ${sentence(c + s + k, 9)}`);
    L.push('\\end{itemize}', '');
    if (s % 2 === 0) {
      L.push(
        '\\begin{table}[htbp]',
        '  \\centering',
        `  \\caption{Results ${c}.${s}}\\label{tab:${c}-${s}}`,
      );
      L.push(
        '  \\begin{tabular}{lcc}',
        '    \\toprule',
        '    Variable & Estimate & SE \\\\',
        '    \\midrule',
      );
      for (let r = 0; r < 4; r++)
        L.push(
          `    $x_${r}$ & ${(c * 0.1 + r).toFixed(2)} & (${(0.01 * (s + r)).toFixed(3)}) \\\\`,
        );
      L.push('    \\bottomrule', '  \\end{tabular}', '\\end{table}', '');
    } else {
      L.push('\\begin{align}');
      L.push(`  y_i &= x_i' \\beta + u_i \\\\`);
      L.push(`  \\E[y_i] &= ${c}\\mu_{${s}}`);
      L.push('\\end{align}', '');
      L.push(
        '\\begin{figure}[htbp]',
        '  \\centering',
        '  \\begin{tikzpicture}',
        '    \\draw (0,0) -- (1,1);',
        '  \\end{tikzpicture}',
        `  \\caption{Diagram ${c}.${s}}`,
        '\\end{figure}',
        '',
      );
    }
  }
  writeFileSync(join(out, 'chapters', `ch${c}.tex`), L.join('\n'));
}
console.log('fixture written to', out);
