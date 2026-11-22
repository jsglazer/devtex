/**
 * Static completion vocabulary and the grouped-syntax palette (sectioning,
 * environments, text size, alignment). Built into the editor so it works on
 * iOS without texlab.
 */

export interface PaletteItem {
  label: string;
  /** Text inserted; `|` marks the cursor position (removed on insert). */
  insert: string;
  detail?: string;
}

export interface PaletteGroup {
  id: 'sectioning' | 'environments' | 'size' | 'alignment';
  title: string;
  items: PaletteItem[];
}

export const SECTIONING = [
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
];
export const SIZES = [
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
];

export const ENVIRONMENTS = [
  'itemize',
  'enumerate',
  'description',
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'split',
  'cases',
  'figure',
  'figure*',
  'table',
  'table*',
  'tabular',
  'tabularx',
  'center',
  'flushleft',
  'flushright',
  'quote',
  'quotation',
  'verse',
  'abstract',
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'definition',
  'remark',
  'example',
  'proof',
  'minipage',
  'verbatim',
  'lstlisting',
  'matrix',
  'pmatrix',
  'bmatrix',
  'array',
  'thebibliography',
  'document',
  'frame',
  'subfigure',
];

export const COMMANDS: { name: string; snippet?: string; detail?: string }[] = [
  ...SECTIONING.map((s) => ({ name: s, snippet: `\\${s}{|}`, detail: 'sectioning' })),
  ...SIZES.map((s) => ({ name: s, detail: 'text size' })),
  { name: 'textbf', snippet: '\\textbf{|}', detail: 'bold' },
  { name: 'textit', snippet: '\\textit{|}', detail: 'italic' },
  { name: 'emph', snippet: '\\emph{|}', detail: 'emphasis' },
  { name: 'underline', snippet: '\\underline{|}' },
  { name: 'texttt', snippet: '\\texttt{|}', detail: 'monospace' },
  { name: 'textsc', snippet: '\\textsc{|}', detail: 'small caps' },
  { name: 'footnote', snippet: '\\footnote{|}' },
  { name: 'label', snippet: '\\label{|}' },
  { name: 'ref', snippet: '\\ref{|}' },
  { name: 'eqref', snippet: '\\eqref{|}' },
  { name: 'autoref', snippet: '\\autoref{|}' },
  { name: 'cref', snippet: '\\cref{|}' },
  { name: 'pageref', snippet: '\\pageref{|}' },
  { name: 'cite', snippet: '\\cite{|}' },
  { name: 'citep', snippet: '\\citep{|}' },
  { name: 'citet', snippet: '\\citet{|}' },
  { name: 'parencite', snippet: '\\parencite{|}' },
  { name: 'textcite', snippet: '\\textcite{|}' },
  { name: 'autocite', snippet: '\\autocite{|}' },
  { name: 'begin', snippet: '\\begin{|}' },
  { name: 'end', snippet: '\\end{|}' },
  { name: 'item', snippet: '\\item |' },
  { name: 'input', snippet: '\\input{|}' },
  { name: 'include', snippet: '\\include{|}' },
  { name: 'includegraphics', snippet: '\\includegraphics[width=\\linewidth]{|}' },
  { name: 'caption', snippet: '\\caption{|}' },
  { name: 'centering' },
  { name: 'raggedright' },
  { name: 'raggedleft' },
  { name: 'usepackage', snippet: '\\usepackage{|}' },
  { name: 'documentclass', snippet: '\\documentclass{|}' },
  { name: 'newcommand', snippet: '\\newcommand{\\|}{}' },
  { name: 'renewcommand', snippet: '\\renewcommand{\\|}{}' },
  { name: 'DeclareMathOperator', snippet: '\\DeclareMathOperator{\\|}{}' },
  { name: 'frac', snippet: '\\frac{|}{}' },
  { name: 'sqrt', snippet: '\\sqrt{|}' },
  { name: 'sum' },
  { name: 'prod' },
  { name: 'int' },
  { name: 'lim' },
  { name: 'infty' },
  { name: 'alpha' },
  { name: 'beta' },
  { name: 'gamma' },
  { name: 'delta' },
  { name: 'epsilon' },
  { name: 'varepsilon' },
  { name: 'theta' },
  { name: 'lambda' },
  { name: 'mu' },
  { name: 'sigma' },
  { name: 'tau' },
  { name: 'phi' },
  { name: 'varphi' },
  { name: 'psi' },
  { name: 'omega' },
  { name: 'Gamma' },
  { name: 'Delta' },
  { name: 'Theta' },
  { name: 'Lambda' },
  { name: 'Sigma' },
  { name: 'Phi' },
  { name: 'Omega' },
  { name: 'mathbb', snippet: '\\mathbb{|}' },
  { name: 'mathcal', snippet: '\\mathcal{|}' },
  { name: 'mathrm', snippet: '\\mathrm{|}' },
  { name: 'mathbf', snippet: '\\mathbf{|}' },
  { name: 'boldsymbol', snippet: '\\boldsymbol{|}' },
  { name: 'text', snippet: '\\text{|}' },
  { name: 'left' },
  { name: 'right' },
  { name: 'cdot' },
  { name: 'times' },
  { name: 'leq' },
  { name: 'geq' },
  { name: 'neq' },
  { name: 'approx' },
  { name: 'sim' },
  { name: 'partial' },
  { name: 'nabla' },
  { name: 'hat', snippet: '\\hat{|}' },
  { name: 'bar', snippet: '\\bar{|}' },
  { name: 'tilde', snippet: '\\tilde{|}' },
  { name: 'quad' },
  { name: 'qquad' },
  { name: 'ldots' },
  { name: 'cdots' },
  { name: 'hline' },
  { name: 'toprule' },
  { name: 'midrule' },
  { name: 'bottomrule' },
  { name: 'href', snippet: '\\href{|}{}' },
  { name: 'url', snippet: '\\url{|}' },
  { name: 'maketitle' },
  { name: 'tableofcontents' },
  { name: 'bibliography', snippet: '\\bibliography{|}' },
  { name: 'printbibliography' },
  { name: 'newpage' },
  { name: 'clearpage' },
  { name: 'noindent' },
  { name: 'vspace', snippet: '\\vspace{|}' },
  { name: 'hspace', snippet: '\\hspace{|}' },
];

export function envSnippet(name: string): string {
  if (name === 'itemize' || name === 'enumerate')
    return `\\begin{${name}}\n  \\item |\n\\end{${name}}`;
  if (name === 'description') return `\\begin{${name}}\n  \\item[|] \n\\end{${name}}`;
  if (name === 'figure' || name === 'figure*')
    return `\\begin{${name}}[htbp]\n  \\centering\n  |\n  \\caption{}\n  \\label{fig:}\n\\end{${name}}`;
  if (name === 'table' || name === 'table*')
    return `\\begin{${name}}[htbp]\n  \\centering\n  \\caption{}\n  \\label{tab:}\n  |\n\\end{${name}}`;
  if (name === 'tabular') return `\\begin{tabular}{|}\n\n\\end{tabular}`;
  return `\\begin{${name}}\n  |\n\\end{${name}}`;
}

export const PALETTE: PaletteGroup[] = [
  {
    id: 'sectioning',
    title: 'Sectioning',
    items: SECTIONING.map((s) => ({ label: `\\${s}`, insert: `\\${s}{|}` })),
  },
  {
    id: 'environments',
    title: 'Environments',
    items: ENVIRONMENTS.filter((e) => e !== 'document').map((e) => ({
      label: e,
      insert: envSnippet(e),
    })),
  },
  {
    id: 'size',
    title: 'Text size',
    items: SIZES.map((s) => ({ label: `\\${s}`, insert: `{\\${s} |}` })),
  },
  {
    id: 'alignment',
    title: 'Alignment',
    items: [
      { label: 'center', insert: envSnippet('center'), detail: 'environment' },
      { label: 'flushleft', insert: envSnippet('flushleft'), detail: 'environment' },
      { label: 'flushright', insert: envSnippet('flushright'), detail: 'environment' },
      { label: '\\centering', insert: '\\centering |', detail: 'declaration' },
      { label: '\\raggedright', insert: '\\raggedright |', detail: 'declaration' },
      { label: '\\raggedleft', insert: '\\raggedleft |', detail: 'declaration' },
    ],
  },
];

/** Split an insert template at its `|` cursor marker. */
export function splitCursor(template: string): { text: string; cursor: number } {
  const i = template.indexOf('|');
  if (i === -1) return { text: template, cursor: template.length };
  return { text: template.slice(0, i) + template.slice(i + 1), cursor: i };
}
