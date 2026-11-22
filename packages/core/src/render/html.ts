/**
 * LaTeX block -> HTML template. Pure: input is a SourceBlock plus the macro
 * set; output is an HTML string containing
 *   - relative line markers  \u0001<n>\u0002  (block-relative, 0-based), which
 *     the incremental renderer materializes into absolute data-source-line
 *     values, so a block that only moved keeps its cached template;
 *   - math slots             \u0003<i>\u0004, filled with MathJax SVG by the
 *     incremental renderer (now, or later when the block becomes visible).
 * Unknown macros, TikZ and unsupported environments render as a labelled
 * placeholder showing the source line; they never fail the preview.
 */
import type * as Ast from '@unified-latex/unified-latex-types';
import { getParser } from '@unified-latex/unified-latex-util-parse';
import type { SourceBlock } from '../blocks.js';
import { expandMacroBody, toParserSignatures, type MacroSet } from '../macros.js';
import { escapeHtml } from '../text.js';

export const LINE_OPEN = '\u0001';
export const LINE_CLOSE = '\u0002';
export const MATH_OPEN = '\u0003';
export const MATH_CLOSE = '\u0004';

/** Marker for a block-relative 0-based line offset. */
export function lineMarker(rel: number): string {
  return `${LINE_OPEN}${rel}${LINE_CLOSE}`;
}

export interface MathJob {
  tex: string;
  display: boolean;
}

export interface BlockTemplate {
  html: string;
  math: MathJob[];
  /** Count of placeholders emitted for unsupported constructs. */
  unsupported: number;
}

export type Parser = ReturnType<typeof getParser>;

/** Signatures unified-latex lacks by default (natbib/biblatex/cleveref …). */
const EXTRA_SIGNATURES: Record<string, { signature: string }> = {
  citep: { signature: 's o o m' },
  citet: { signature: 's o o m' },
  citealp: { signature: 's o o m' },
  citealt: { signature: 's o o m' },
  citeauthor: { signature: 's o o m' },
  citeyear: { signature: 's o o m' },
  parencite: { signature: 's o o m' },
  textcite: { signature: 's o o m' },
  autocite: { signature: 's o o m' },
  footcite: { signature: 'o o m' },
  Cite: { signature: 'o o m' },
  cref: { signature: 'm' },
  Cref: { signature: 'm' },
  hyperref: { signature: 'o m' },
  textsf: { signature: 'm' },
  textrm: { signature: 'm' },
  textmd: { signature: 'm' },
  textup: { signature: 'm' },
  textsl: { signature: 'm' },
  underline: { signature: 'm' },
  vspace: { signature: 's m' },
  hspace: { signature: 's m' },
  bibliography: { signature: 'm' },
  bibliographystyle: { signature: 'm' },
  printbibliography: { signature: 'o' },
  addbibresource: { signature: 'o m' },
  input: { signature: 'm' },
  include: { signature: 'm' },
};

/** Build a parser that knows the user's macro arities. */
export function makeParser(macros: MacroSet): Parser {
  return getParser({ macros: { ...EXTRA_SIGNATURES, ...toParserSignatures(macros) } });
}

const SECTION_LEVEL: Record<string, number> = {
  part: 1,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const TEXT_STYLE: Record<string, [string, string]> = {
  textbf: ['<strong>', '</strong>'],
  textit: ['<em>', '</em>'],
  emph: ['<em>', '</em>'],
  textsl: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  texttt: ['<code>', '</code>'],
  textsc: ['<span class="dt-sc">', '</span>'],
  textsf: ['<span class="dt-sf">', '</span>'],
  textrm: ['<span>', '</span>'],
  textmd: ['<span>', '</span>'],
  textup: ['<span>', '</span>'],
  textnormal: ['<span>', '</span>'],
  mbox: ['<span>', '</span>'],
  text: ['<span>', '</span>'],
};

const CITE = new Set([
  'cite',
  'citep',
  'citet',
  'citealp',
  'citealt',
  'citeauthor',
  'citeyear',
  'parencite',
  'textcite',
  'autocite',
  'footcite',
  'Cite',
  'nocite',
]);
const REF = new Set(['ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref', 'nameref', 'vref']);

const SYMBOLS: Record<string, string> = {
  '%': '%',
  '&': '&amp;',
  $: '$',
  '#': '#',
  _: '_',
  '{': '{',
  '}': '}',
  ' ': ' ',
  ',': ' ',
  ';': ' ',
  ':': ' ',
  '!': '',
  '-': '',
  '/': '',
  '@': '',
  ldots: '…',
  dots: '…',
  textellipsis: '…',
  LaTeX: 'L<sup>A</sup>T<sub>E</sub>X',
  TeX: 'T<sub>E</sub>X',
  LaTeXe: 'L<sup>A</sup>T<sub>E</sub>X 2ε',
  textbackslash: '\\',
  S: '§',
  P: '¶',
  copyright: '©',
  textregistered: '®',
  texttrademark: '™',
  dag: '†',
  ddag: '‡',
  ss: 'ß',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  o: 'ø',
  O: 'Ø',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  j: 'ȷ',
  textendash: '–',
  textemdash: '—',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  textbullet: '•',
  textdegree: '°',
  quad: ' ',
  qquad: '  ',
  enspace: ' ',
  thinspace: ' ',
  textasciitilde: '~',
  textasciicircum: '^',
  textbar: '|',
  textless: '&lt;',
  textgreater: '&gt;',
  euro: '€',
  pounds: '£',
  today: '[today]',
};

const ACCENTS: Record<string, string> = {
  "'": '́',
  '`': '̀',
  '^': '̂',
  '"': '̈',
  '~': '̃',
  '=': '̄',
  '.': '̇',
  u: '̆',
  v: '̌',
  H: '̋',
  c: '̧',
  k: '̨',
  r: '̊',
};

/** Declarations and layout commands that render as nothing (supported, no output). */
const IGNORED = new Set([
  'centering',
  'raggedright',
  'raggedleft',
  'noindent',
  'indent',
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
  'bfseries',
  'itshape',
  'ttfamily',
  'rmfamily',
  'sffamily',
  'scshape',
  'upshape',
  'mdseries',
  'normalfont',
  'em',
  'bf',
  'it',
  'tt',
  'sf',
  'sc',
  'rm',
  'sl',
  'hfill',
  'vfill',
  'vspace',
  'hspace',
  'smallskip',
  'medskip',
  'bigskip',
  'newpage',
  'clearpage',
  'cleardoublepage',
  'pagebreak',
  'nopagebreak',
  'maketitle',
  'bibliographystyle',
  'addbibresource',
  'label',
  'protect',
  'relax',
  'nocite',
  'hline',
  'toprule',
  'midrule',
  'bottomrule',
  'cline',
  'cmidrule',
  'addlinespace',
  'phantomsection',
  'addcontentsline',
  'frontmatter',
  'mainmatter',
  'backmatter',
  'appendix',
  'onehalfspacing',
  'doublespacing',
  'singlespacing',
  'thispagestyle',
  'pagestyle',
  'setlength',
  'linespread',
  'selectfont',
  'fontsize',
  'usepackage',
  'documentclass',
  'newcommand',
  'renewcommand',
  'providecommand',
  'DeclareMathOperator',
  'def',
  'newtheorem',
  'graphicspath',
  'hypersetup',
  'allowbreak',
  'strut',
  'null',
  'ignorespaces',
  'unskip',
  'xspace',
]);

const LIST_ENVS: Record<string, string> = { itemize: 'ul', enumerate: 'ol', description: 'dl' };
const TABLE_ENVS = new Set([
  'tabular',
  'tabular*',
  'tabularx',
  'tabulary',
  'longtable',
  'supertabular',
]);
const FLOAT_ENVS = new Set(['figure', 'figure*', 'table', 'table*', 'wrapfigure', 'subfigure']);
const ALIGN_ENVS: Record<string, string> = {
  center: 'center',
  flushleft: 'left',
  flushright: 'right',
};
const QUOTE_ENVS = new Set(['quote', 'quotation', 'verse']);
const THEOREM_ENVS = new Set([
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'definition',
  'remark',
  'example',
  'proof',
  'assumption',
  'conjecture',
  'claim',
  'note',
  'exercise',
  'problem',
  'solution',
  'hypothesis',
]);
const CODE_ENVS = new Set(['lstlisting', 'minted', 'Verbatim', 'verbatim', 'verbatim*', 'comment']);
const PASSTHROUGH_ENVS = new Set([
  'document',
  'minipage',
  'singlespace',
  'doublespace',
  'spacing',
  'small',
  'footnotesize',
]);

function envName(node: Ast.Environment | Ast.VerbatimEnvironment): string {
  const e: unknown = node.env;
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && 'content' in e) {
    const c = e.content;
    if (typeof c === 'string') return c;
  }
  return '';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Minimal raw printer, used when source positions are unavailable. */
export function printRaw(nodes: readonly Ast.Node[]): string {
  let s = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'string':
        s += n.content;
        break;
      case 'whitespace':
        s += ' ';
        break;
      case 'parbreak':
        s += '\n\n';
        break;
      case 'comment':
        s += `%${n.content}\n`;
        break;
      case 'macro':
        s += `${n.escapeToken ?? '\\'}${n.content}`;
        for (const a of n.args ?? []) s += `${a.openMark}${printRaw(a.content)}${a.closeMark}`;
        break;
      case 'group':
        s += `{${printRaw(n.content)}}`;
        break;
      case 'inlinemath':
        s += `$${printRaw(n.content)}$`;
        break;
      case 'displaymath':
        s += `\\[${printRaw(n.content)}\\]`;
        break;
      case 'environment':
      case 'mathenv': {
        const name = envName(n);
        s += `\\begin{${name}}`;
        for (const a of n.args ?? []) s += `${a.openMark}${printRaw(a.content)}${a.closeMark}`;
        s += `${printRaw(n.content)}\\end{${name}}`;
        break;
      }
      case 'verbatim':
        s += `\\begin{${n.env}}${n.content}\\end{${n.env}}`;
        break;
      case 'verb':
        s += `\\${n.env}${n.escape}${n.content}${n.escape}`;
        break;
      case 'root':
        s += printRaw(n.content);
        break;
    }
  }
  return s;
}

function smartText(s: string): string {
  return escapeHtml(s)
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/`/g, '‘')
    .replace(/~/g, '&nbsp;');
}

function mandatoryArgs(node: Ast.Macro): Ast.Argument[] {
  return (node.args ?? []).filter((a) => a.openMark === '{');
}

function optionalArgs(node: Ast.Macro): Ast.Argument[] {
  return (node.args ?? []).filter((a) => a.openMark === '[' && a.content.length > 0);
}

function lastMandatory(node: Ast.Macro): Ast.Argument | undefined {
  const m = mandatoryArgs(node);
  return m[m.length - 1];
}

const MAX_EXPANSION_DEPTH = 8;

class BlockRenderer {
  readonly math: MathJob[] = [];
  unsupported = 0;

  constructor(
    private readonly src: string,
    private readonly macros: MacroSet,
    private readonly parser: Parser,
    private readonly lineOffset: number,
    private readonly depth: number,
  ) {}

  private relLine(node: Ast.Node | undefined): number {
    const l = node?.position?.start.line;
    return (l === undefined ? 1 : l) - 1 + this.lineOffset;
  }

  private sourceOf(node: Ast.Node): string {
    const p = node.position;
    if (p !== undefined && this.depth === 0) return this.src.slice(p.start.offset, p.end.offset);
    return printRaw([node]);
  }

  private argSource(arg: Ast.Argument | undefined): string {
    if (!arg) return '';
    const first = arg.content[0];
    const last = arg.content[arg.content.length - 1];
    const a = first?.position?.start.offset;
    const b = last?.position?.end.offset;
    if (a !== undefined && b !== undefined && this.depth === 0) return this.src.slice(a, b);
    return printRaw(arg.content);
  }

  private mathSlot(tex: string, display: boolean): string {
    const i = this.math.length;
    this.math.push({ tex, display });
    const cls = display ? 'dt-math dt-math-display' : 'dt-math dt-math-inline';
    const tag = display ? 'div' : 'span';
    return `<${tag} class="${cls}">${MATH_OPEN}${i}${MATH_CLOSE}</${tag}>`;
  }

  private placeholder(label: string, node: Ast.Node | undefined, block: boolean): string {
    this.unsupported++;
    const line = lineMarker(this.relLine(node));
    const tag = block ? 'div' : 'span';
    return `<${tag} class="dt-unsupported" data-source-line="${line}" title="Not rendered in the HTML preview">${escapeHtml(label)} <span class="dt-unsupported-line">(line ${line})</span></${tag}>`;
  }

  renderNodes(nodes: readonly Ast.Node[]): string {
    let out = '';
    let text = '';
    const flushText = (): void => {
      if (text !== '') out += smartText(text);
      text = '';
    };
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n === undefined) continue;
      if (n.type === 'string') {
        text += n.content;
        continue;
      }
      if (n.type === 'whitespace') {
        text += ' ';
        continue;
      }
      flushText();
      if (n.type === 'macro' && ACCENTS[n.content] !== undefined && (n.args ?? []).length === 0) {
        // \'e : accent applies to the first char of the following string
        const next = nodes[i + 1];
        const mark = ACCENTS[n.content] ?? '';
        if (next?.type === 'string' && next.content.length > 0) {
          out += escapeHtml(
            (next.content.charAt(0) + mark).normalize('NFC') + next.content.slice(1),
          );
          i++;
          continue;
        }
        if (next?.type === 'group') {
          out += escapeHtml((printRaw(next.content) + mark).normalize('NFC'));
          i++;
          continue;
        }
      }
      out += this.renderNode(n);
    }
    flushText();
    return out;
  }

  renderNode(n: Ast.Node): string {
    switch (n.type) {
      case 'root':
        return this.renderNodes(n.content);
      case 'string':
        return smartText(n.content);
      case 'whitespace':
        return ' ';
      case 'parbreak':
        return '<br class="dt-parbreak">';
      case 'comment':
        return '';
      case 'group':
        return this.renderNodes(n.content);
      case 'inlinemath':
        return this.renderInlineMath(n);
      case 'displaymath':
        return this.renderDisplayMath(n);
      case 'macro':
        return this.renderMacro(n);
      case 'environment':
      case 'mathenv':
        return this.renderEnvironment(n);
      case 'verbatim':
        return `<pre class="dt-code" data-source-line="${lineMarker(this.relLine(n))}">${escapeHtml(n.content.replace(/^\n/, ''))}</pre>`;
      case 'verb':
        return `<code>${escapeHtml(n.content)}</code>`;
    }
  }

  private renderInlineMath(n: Ast.InlineMath): string {
    const s = this.sourceOf(n);
    let tex = s;
    if (s.startsWith('$') && s.endsWith('$')) tex = s.slice(1, -1);
    else if (s.startsWith('\\(') && s.endsWith('\\)')) tex = s.slice(2, -2);
    return this.mathSlot(tex, false);
  }

  private renderDisplayMath(n: Ast.DisplayMath): string {
    const s = this.sourceOf(n);
    let tex = s;
    if (s.startsWith('$$') && s.endsWith('$$')) tex = s.slice(2, -2);
    else if (s.startsWith('\\[') && s.endsWith('\\]')) tex = s.slice(2, -2);
    return `<div class="dt-display" data-source-line="${lineMarker(this.relLine(n))}">${this.mathSlot(tex, true)}</div>`;
  }

  private renderMacro(n: Ast.Macro): string {
    const name = n.content;
    const sym = SYMBOLS[name];
    if (sym !== undefined && (n.escapeToken === undefined || n.escapeToken === '\\')) return sym;
    if (name === '\\' || name === 'newline' || name === 'linebreak') return '<br>';
    if (name === 'par') return '<br class="dt-parbreak">';
    if (IGNORED.has(name)) return '';

    const level = SECTION_LEVEL[name];
    if (level !== undefined) {
      const title = this.renderNodes(lastMandatory(n)?.content ?? []);
      const starred = (n.args ?? []).some((a) =>
        a.content.some((c) => c.type === 'string' && c.content === '*'),
      );
      return `<h${level} class="dt-heading dt-${name}${starred ? ' dt-starred' : ''}" data-source-line="${lineMarker(this.relLine(n))}">${title}</h${level}>`;
    }
    const style = TEXT_STYLE[name];
    if (style !== undefined)
      return `${style[0]}${this.renderNodes(lastMandatory(n)?.content ?? [])}${style[1]}`;

    if (CITE.has(name)) {
      const keys = this.argSource(lastMandatory(n))
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k !== '');
      const notes = optionalArgs(n).map((a) => this.argSource(a));
      const label = [...keys, ...notes].join(', ');
      return `<span class="dt-cite" data-keys="${escapeHtml(keys.join(','))}">[${escapeHtml(label)}]</span>`;
    }
    if (REF.has(name)) {
      const label = this.argSource(lastMandatory(n)).trim();
      const text = name === 'eqref' ? `(${label})` : label;
      return `<a class="dt-ref" data-label="${escapeHtml(label)}">${escapeHtml(text)}</a>`;
    }
    if (name === 'href') {
      const [url, body] = mandatoryArgs(n);
      return `<a class="dt-link" data-href="${escapeHtml(this.argSource(url))}">${this.renderNodes(body?.content ?? [])}</a>`;
    }
    if (name === 'url') {
      const u = this.argSource(lastMandatory(n));
      return `<a class="dt-link" data-href="${escapeHtml(u)}">${escapeHtml(u)}</a>`;
    }
    if (name === 'footnote') {
      return `<sup class="dt-footnote">*<span class="dt-footnote-body">${this.renderNodes(lastMandatory(n)?.content ?? [])}</span></sup>`;
    }
    if (name === 'caption') {
      return `<figcaption data-source-line="${lineMarker(this.relLine(n))}">${this.renderNodes(lastMandatory(n)?.content ?? [])}</figcaption>`;
    }
    if (name === 'item') {
      return `<span class="dt-bullet">•</span> ${this.renderNodes(lastMandatory(n)?.content ?? itemBody(n))}`;
    }
    if (name === 'includegraphics') {
      return this.placeholder(`[image: ${this.argSource(lastMandatory(n))}]`, n, false);
    }
    if (name === 'tableofcontents' || name === 'listoffigures' || name === 'listoftables') {
      return this.placeholder(`[${name}]`, n, true);
    }
    if (name === 'bibliography' || name === 'printbibliography') {
      return `<h2 class="dt-heading" data-source-line="${lineMarker(this.relLine(n))}">References</h2>`;
    }
    if (name === 'input' || name === 'include' || name === 'subfile') {
      return this.placeholder(`[\\${name}{${this.argSource(lastMandatory(n))}}]`, n, true);
    }

    const def = this.macros.get(name);
    if (def !== undefined && this.depth < MAX_EXPANSION_DEPTH) {
      const args = (n.args ?? []).map((a) =>
        a.openMark === '' && a.content.length === 0 ? '' : this.argSource(a),
      );
      if (def.optionalDefault !== undefined && (args[0] === undefined || args[0] === '')) {
        args[0] = def.optionalDefault;
      }
      const expanded = expandMacroBody(def, args);
      const ast = this.parser.parse(expanded);
      const sub = new BlockRenderer(
        expanded,
        this.macros,
        this.parser,
        this.relLine(n),
        this.depth + 1,
      );
      const html = sub.renderNodes(ast.content);
      for (const job of sub.math) {
        this.math.push(job);
      }
      this.unsupported += sub.unsupported;
      // renumber the sub-renderer's math slots into this block's slot space
      const base = this.math.length - sub.math.length;
      return html.replace(
        new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'),
        (_m, d: string) => `${MATH_OPEN}${base + Number(d)}${MATH_CLOSE}`,
      );
    }
    return this.placeholder(this.sourceOf(n), n, false);
  }

  private renderEnvironment(n: Ast.Environment): string {
    const name = envName(n);
    const line = lineMarker(this.relLine(n));
    if (
      n.type === 'mathenv' ||
      /^(equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math)\*?$/.test(name)
    ) {
      return `<div class="dt-display" data-source-line="${line}">${this.mathSlot(this.sourceOf(n), true)}</div>`;
    }
    const list = LIST_ENVS[name];
    if (list !== undefined) return this.renderList(n, list);
    if (TABLE_ENVS.has(name)) return this.renderTabular(n);
    if (FLOAT_ENVS.has(name)) {
      return `<figure class="dt-float dt-${name.replace('*', '')}" data-source-line="${line}">${this.renderNodes(n.content)}</figure>`;
    }
    const align = ALIGN_ENVS[name];
    if (align !== undefined) {
      return `<div class="dt-align" style="text-align:${align}" data-source-line="${line}">${this.renderNodes(n.content)}</div>`;
    }
    if (QUOTE_ENVS.has(name))
      return `<blockquote data-source-line="${line}">${this.renderNodes(n.content)}</blockquote>`;
    if (name === 'abstract') {
      return `<div class="dt-abstract" data-source-line="${line}"><div class="dt-abstract-title">Abstract</div>${this.renderNodes(n.content)}</div>`;
    }
    const base = name.replace('*', '');
    if (THEOREM_ENVS.has(base)) {
      const opt = (n.args ?? []).find((a) => a.openMark === '[' && a.content.length > 0);
      const title = opt ? ` (${this.renderNodes(opt.content)})` : '';
      return `<div class="dt-thm dt-${base}" data-source-line="${line}"><span class="dt-thm-label">${capitalize(base)}${title}.</span> ${this.renderNodes(n.content)}</div>`;
    }
    if (CODE_ENVS.has(name)) {
      const src = this.sourceOf(n);
      const body = src
        .replace(/^\\begin\{[^}]+\}(\[[^\]]*\])?(\{[^}]*\})?\n?/, '')
        .replace(/\\end\{[^}]+\}$/, '');
      return `<pre class="dt-code" data-source-line="${line}">${escapeHtml(body)}</pre>`;
    }
    if (PASSTHROUGH_ENVS.has(name))
      return `<div data-source-line="${line}">${this.renderNodes(n.content)}</div>`;
    return this.placeholder(`[unsupported environment: ${name}]`, n, true);
  }

  private renderList(n: Ast.Environment, tag: string): string {
    const items: { node: Ast.Macro | null; body: Ast.Node[] }[] = [];
    for (const c of n.content) {
      if (c.type === 'macro' && c.content === 'item') items.push({ node: c, body: itemBody(c) });
      else if (items.length > 0) items[items.length - 1]?.body.push(c);
      else if (c.type !== 'whitespace' && c.type !== 'parbreak' && c.type !== 'comment')
        items.push({ node: null, body: [c] });
    }
    const line = lineMarker(this.relLine(n));
    let out = `<${tag} class="dt-list" data-source-line="${line}">`;
    for (const it of items) {
      const l = lineMarker(this.relLine(it.node ?? undefined));
      const labelArg = it.node ? (it.node.args ?? []).find((a) => a.openMark === '[') : undefined;
      if (tag === 'dl') {
        out += `<dt data-source-line="${l}">${labelArg ? this.renderNodes(labelArg.content) : ''}</dt><dd data-source-line="${l}">${this.renderNodes(it.body)}</dd>`;
      } else {
        const custom = labelArg ? ` data-label="${escapeHtml(printRaw(labelArg.content))}"` : '';
        out += `<li data-source-line="${l}"${custom}>${this.renderNodes(it.body)}</li>`;
      }
    }
    return `${out}</${tag}>`;
  }

  private renderTabular(n: Ast.Environment): string {
    const specArg = (n.args ?? []).filter((a) => a.openMark === '{').pop();
    const spec = specArg ? printRaw(specArg.content) : '';
    const aligns = parseColumnSpec(spec);
    const rows: Ast.Node[][][] = [[[]]];
    const rowLines: (Ast.Node | undefined)[] = [undefined];
    for (const c of n.content) {
      const row = rows[rows.length - 1] ?? [];
      if (c.type === 'macro' && (c.content === '\\' || c.content === 'tabularnewline')) {
        rows.push([[]]);
        rowLines.push(undefined);
        continue;
      }
      if (c.type === 'string' && c.content.includes('&')) {
        const parts = c.content.split('&');
        parts.forEach((p, k) => {
          if (k > 0) row.push([]);
          if (p !== '') row[row.length - 1]?.push({ type: 'string', content: p });
        });
        continue;
      }
      if (
        rowLines[rowLines.length - 1] === undefined &&
        c.type !== 'whitespace' &&
        c.type !== 'comment'
      ) {
        rowLines[rowLines.length - 1] = c;
      }
      row[row.length - 1]?.push(c);
    }
    let out = `<table class="dt-tabular" data-source-line="${lineMarker(this.relLine(n))}">`;
    rows.forEach((cells, r) => {
      const rendered = cells.map((cell) => this.renderNodes(cell).trim());
      if (rendered.every((h) => h === '')) return;
      out += `<tr data-source-line="${lineMarker(this.relLine(rowLines[r] ?? n))}">`;
      rendered.forEach((h, k) => {
        const al = aligns[k];
        out += al ? `<td style="text-align:${al}">${h}</td>` : `<td>${h}</td>`;
      });
      out += '</tr>';
    });
    return `${out}</table>`;
  }
}

function itemBody(item: Ast.Macro): Ast.Node[] {
  const args = item.args ?? [];
  const last = args[args.length - 1];
  return last ? [...last.content] : [];
}

/** Column alignments from a tabular spec like `l|c|p{3cm}r`. */
export function parseColumnSpec(spec: string): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  let i = 0;
  while (i < spec.length) {
    const c = spec[i] ?? '';
    if (c === '{') {
      let depth = 1;
      i++;
      while (i < spec.length && depth > 0) {
        if (spec[i] === '{') depth++;
        else if (spec[i] === '}') depth--;
        i++;
      }
      continue;
    }
    if (c === 'l') out.push('left');
    else if (c === 'c') out.push('center');
    else if (c === 'r') out.push('right');
    else if (c === 'p' || c === 'm' || c === 'b' || c === 'X') out.push(undefined);
    i++;
  }
  return out;
}

const BLOCK_CLASS: Record<string, string> = {
  paragraph: 'dt-p',
  heading: 'dt-h',
  environment: 'dt-env',
  display: 'dt-dm',
  include: 'dt-include',
};

/**
 * Render one block to a template. Throws only on internal bugs; the
 * incremental renderer converts any exception into a placeholder block.
 */
export function renderBlockTemplate(
  block: SourceBlock,
  macros: MacroSet,
  parser: Parser,
  ast: Ast.Root = parser.parse(block.text),
): BlockTemplate {
  const r = new BlockRenderer(block.text, macros, parser, 0, 0);
  const body = r.renderNodes(ast.content);
  const lastRel = block.endLine - block.startLine;
  const html = `<div class="dt-block ${BLOCK_CLASS[block.kind] ?? ''}" data-source-file="${escapeHtml(block.file)}" data-source-line="${lineMarker(0)}" data-source-end-line="${lineMarker(lastRel)}">${body}</div>`;
  return { html, math: r.math, unsupported: r.unsupported };
}

/** Placeholder template for a block that failed to render. */
export function errorBlockTemplate(block: SourceBlock, message: string): BlockTemplate {
  const lastRel = block.endLine - block.startLine;
  return {
    html: `<div class="dt-block dt-error" data-source-file="${escapeHtml(block.file)}" data-source-line="${lineMarker(0)}" data-source-end-line="${lineMarker(lastRel)}"><div class="dt-unsupported">[preview could not render this block: ${escapeHtml(message)}] <span class="dt-unsupported-line">(line ${lineMarker(0)})</span></div></div>`,
    math: [],
    unsupported: 1,
  };
}
