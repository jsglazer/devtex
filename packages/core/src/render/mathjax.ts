/**
 * MathJax 3 SVG output through its liteDOM adaptor — no browser DOM, so it runs
 * inside the preview Web Worker (and in Node tests). Output is cached by
 * (TeX string, display flag, macro-set hash). Do not use KaTeX (decision).
 */
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor, type LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';
import type { LiteElement, LiteNode } from 'mathjax-full/js/adaptors/lite/Element.js';
import type { LiteText } from 'mathjax-full/js/adaptors/lite/Text.js';
import type { LiteDocument } from 'mathjax-full/js/adaptors/lite/Document.js';
import { macroSetHash, toMathJaxMacros, type MacroSet } from '../macros.js';
import { escapeHtml } from '../text.js';

/** Port: typesets one TeX string to HTML/SVG markup. */
export interface MathRenderer {
  /** Install the macro set (idempotent for an unchanged set). */
  setMacros(macros: MacroSet): void;
  render(tex: string, display: boolean): string;
}

type LiteMathDocument = MathDocument<LiteNode, LiteText, LiteDocument>;

let adaptorSingleton: LiteAdaptor | null = null;
function adaptor(): LiteAdaptor {
  if (adaptorSingleton === null) {
    adaptorSingleton = liteAdaptor();
    RegisterHTMLHandler(adaptorSingleton);
  }
  return adaptorSingleton;
}

const MAX_CACHE = 5000;

/**
 * TeX packages loaded into MathJax. `html` is excluded: its `\href`, `\class`,
 * `\style` and `\cssId` would turn math into live links / arbitrary styling
 * (`$\href{https://…}{x}$` navigated the app's only window away).
 */
export const MATHJAX_PACKAGES: readonly string[] = AllPackages.filter(
  (p) => p !== 'bussproofs' && p !== 'html',
);

export class MathJaxRenderer implements MathRenderer {
  private doc: LiteMathDocument | null = null;
  private macroHash = '';
  private readonly cache = new Map<string, string>();

  setMacros(macros: MacroSet): void {
    const h = macroSetHash(macros);
    if (this.doc !== null && h === this.macroHash) return;
    this.macroHash = h;
    adaptor(); // registers the liteDOM HTML handler before creating a document
    const tex = new TeX<LiteNode, LiteText, LiteDocument>({
      packages: [...MATHJAX_PACKAGES],
      macros: toMathJaxMacros(macros),
      formatError: (_jax: unknown, err: { message: string }) => {
        throw new Error(err.message);
      },
    });
    const svg = new SVG<LiteNode, LiteText, LiteDocument>({ fontCache: 'none' });
    this.doc = mathjax.document('', { InputJax: tex, OutputJax: svg }) as LiteMathDocument;
  }

  render(tex: string, display: boolean): string {
    const key = `${this.macroHash}\u0000${display ? 'D' : 'I'}\u0000${tex}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (this.doc === null) this.setMacros(new Map());
    const doc = this.doc;
    let html: string;
    try {
      if (doc === null) throw new Error('MathJax not initialised');
      const node = doc.convert(tex, { display }) as LiteElement;
      html = adaptor().outerHTML(node);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      html = `<span class="dt-math-error" title="${escapeHtml(msg)}">${escapeHtml(tex)}</span>`;
    }
    if (this.cache.size >= MAX_CACHE) {
      const first = this.cache.keys().next();
      if (first.done !== true) this.cache.delete(first.value);
    }
    this.cache.set(key, html);
    return html;
  }
}
