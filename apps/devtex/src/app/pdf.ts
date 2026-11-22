/**
 * PDF pane: pdf.js in the webview (both platforms) with SyncTeX highlights as
 * an overlay. Forward/inverse search use @devtex/core's SyncTeX port.
 */
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  decodeSyncTex,
  parseSyncTex,
  syncToPdf,
  syncToSource,
  clampZoom,
  stepZoom,
  type SyncTexData,
} from '@devtex/core';

type Rect = { left: number; top: number; right: number; bottom: number };

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PageView {
  wrap: HTMLElement;
  scale: number;
  heightPt: number;
  /** Layout generation whose canvas is drawn (-1 = not yet). */
  renderedGen: number;
}

export class PdfPane {
  private pages: PageView[] = [];
  private synctex: SyncTexData | null = null;
  /** Absolute folder latexmk ran in (root's folder); SyncTeX inputs are relative to it. */
  private baseDir = '';
  private projectRoot = '';
  private overlay: HTMLElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onInverse: (file: string, line: number) => void,
    private readonly onZoom?: (zoom: number) => void,
  ) {
    this.visibleObserver = new IntersectionObserver((entries) => this.onVisible(entries), {
      root: container,
      rootMargin: '800px 0px',
    });
    // relayout when the pane is first shown or resized
    new ResizeObserver(() => {
      const w = this.container.clientWidth;
      if (this.doc !== null && w > 0 && Math.abs(w - this.layoutWidth) > 8) void this.render();
    }).observe(container);
    // trackpad pinch (ctrl+wheel in WebKit) zooms the PDF only
    container.addEventListener(
      'wheel',
      (ev) => {
        if (!ev.ctrlKey || this.doc === null) return;
        ev.preventDefault();
        this.pinch += ev.deltaY;
        if (this.pinchTimer !== null) return;
        this.pinchTimer = setTimeout(() => {
          const dir = this.pinch < 0 ? 1 : -1;
          this.pinch = 0;
          this.pinchTimer = null;
          void this.setZoom(stepZoom(this.zoom, dir, 0.25, 4));
        }, 120);
      },
      { passive: false },
    );
  }

  private pinch = 0;
  private pinchTimer: ReturnType<typeof setTimeout> | null = null;

  /** 1 = fit page width to the pane; other values multiply that. */
  private zoom = 1;
  private doc: pdfjs.PDFDocumentProxy | null = null;
  private task: pdfjs.PDFDocumentLoadingTask | null = null;
  /** Incremented per render so an older, slower render stops early. */
  private generation = 0;
  private marker: { page: number; x: number; y: number; rect: Rect | null } | null = null;

  async load(
    bytes: Uint8Array,
    synctexBytes: Uint8Array | null,
    baseDirAbs: string,
    projectRootAbs: string,
  ): Promise<void> {
    this.baseDir = baseDirAbs;
    this.projectRoot = projectRootAbs;
    this.synctex = synctexBytes ? parseSyncTex(decodeSyncTex(synctexBytes)) : null;
    await this.task?.destroy(); // frees the previous document in the pdf.js worker
    this.doc = null;
    this.task = pdfjs.getDocument({ data: bytes });
    this.doc = await this.task.promise;
    this.marker = null;
    this.sizes = [];
    await this.render();
  }

  getZoom(): number {
    return this.zoom;
  }

  /** Re-render at a new zoom, keeping the same relative scroll position. */
  async setZoom(z: number): Promise<void> {
    const next = clampZoom(z, 0.25, 4);
    if (next === this.zoom && this.pages.length > 0) return;
    this.zoom = next;
    this.onZoom?.(next);
    await this.render();
  }

  hasDocument(): boolean {
    return this.doc !== null;
  }

  /** Page sizes in PDF points at scale 1, cached per document. */
  private sizes: { w: number; h: number }[] = [];
  private layoutWidth = 0;
  private readonly visibleObserver: IntersectionObserver;

  /**
   * Layout pass: sized placeholders for every page (cheap), then canvases are
   * drawn only for pages near the viewport (onVisible). Never blocks on
   * rasterizing the whole document.
   */
  private async render(): Promise<void> {
    const doc = this.doc;
    if (doc === null) return;
    const gen = ++this.generation;
    const c = this.container;
    const width = c.clientWidth;
    if (width === 0) return; // pane hidden: the ResizeObserver lays out once it is shown
    if (this.sizes.length !== doc.numPages) {
      const sizes: { w: number; h: number }[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
        if (gen !== this.generation) return;
        sizes.push({ w: vp.width, h: vp.height });
      }
      this.sizes = sizes;
    }
    const relTop = c.scrollHeight > 0 ? c.scrollTop / c.scrollHeight : 0;
    const relLeft = c.scrollWidth > 0 ? c.scrollLeft / c.scrollWidth : 0;
    const fitWidth = Math.max(300, width - 24);
    this.layoutWidth = width;
    this.visibleObserver.disconnect();
    const frag = document.createDocumentFragment();
    const pages: PageView[] = this.sizes.map((size, idx) => {
      const scale = (fitWidth / size.w) * this.zoom;
      const wrap = document.createElement('div');
      wrap.className = 'dt-pdf-page';
      wrap.dataset['page'] = String(idx + 1);
      wrap.style.width = `${Math.floor(size.w * scale)}px`;
      wrap.style.height = `${Math.floor(size.h * scale)}px`;
      frag.append(wrap);
      const pv: PageView = { wrap, scale, heightPt: size.h, renderedGen: -1 };
      wrap.addEventListener('click', (ev) => this.onClick(ev, idx + 1, pv));
      return pv;
    });
    c.replaceChildren(frag);
    this.pages = pages;
    this.overlay = null;
    c.scrollTop = relTop * c.scrollHeight;
    c.scrollLeft = relLeft * c.scrollWidth;
    for (const pv of pages) this.visibleObserver.observe(pv.wrap);
    const m = this.marker;
    const mpv = m ? this.pages[m.page - 1] : undefined;
    if (m && mpv) this.drawMarker(mpv, m.page, m.x, m.y, m.rect);
  }

  private onVisible(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const n = Number((e.target as HTMLElement).dataset['page']);
      const pv = this.pages[n - 1];
      if (pv && pv.renderedGen !== this.generation) void this.renderPage(n, pv, this.generation);
    }
  }

  private async renderPage(n: number, pv: PageView, gen: number): Promise<void> {
    const doc = this.doc;
    if (doc === null) return;
    pv.renderedGen = gen;
    const page = await doc.getPage(n);
    if (gen !== this.generation) return;
    const vp = page.getViewport({ scale: pv.scale * window.devicePixelRatio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    if (gen !== this.generation) return;
    pv.wrap.querySelector('canvas')?.remove();
    pv.wrap.prepend(canvas);
  }

  private toAbs(rel: string): string {
    return `${this.projectRoot}/${rel}`;
  }

  private toRel(abs: string): string | null {
    const prefix = `${this.projectRoot}/`;
    return abs.startsWith(prefix) ? abs.slice(prefix.length) : null;
  }

  private onClick(ev: MouseEvent, page: number, pv: PageView): void {
    if (this.synctex === null) return;
    const rect = pv.wrap.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / pv.scale;
    const y = (ev.clientY - rect.top) / pv.scale;
    const src = syncToSource(this.synctex, page, x, y, this.baseDir);
    const rel = src ? this.toRel(src.file) : null;
    if (src && rel !== null) {
      this.drawMarker(pv, page, x, y, null);
      this.onInverse(rel, src.line);
    }
  }

  /** Source -> PDF: scroll to and highlight (file, line). Returns false without SyncTeX data. */
  reveal(relFile: string, line: number): boolean {
    if (this.synctex === null) return false;
    const loc = syncToPdf(this.synctex, this.toAbs(relFile), line, this.baseDir);
    if (!loc) return false;
    const pv = this.pages[loc.page - 1];
    if (!pv) return false;
    this.drawMarker(pv, loc.page, loc.x, loc.y, loc.rect ?? null);
    pv.wrap.scrollIntoView({ block: 'nearest' });
    this.overlay?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  private drawMarker(pv: PageView, page: number, x: number, y: number, r: Rect | null): void {
    this.marker = { page, x, y, rect: r };
    this.overlay?.remove();
    const o = document.createElement('div');
    o.className = 'dt-pdf-highlight';
    if (r !== null && r.right > r.left && r.bottom > r.top && r.right < 2e15) {
      o.style.left = `${r.left * pv.scale}px`;
      o.style.top = `${r.top * pv.scale}px`;
      o.style.width = `${(r.right - r.left) * pv.scale}px`;
      o.style.height = `${(r.bottom - r.top) * pv.scale}px`;
    } else {
      o.style.left = '0';
      o.style.right = '0';
      o.style.top = `${(y - 10) * pv.scale}px`;
      o.style.height = `${14 * pv.scale}px`;
      void x;
    }
    pv.wrap.append(o);
    this.overlay = o;
  }

  hasSyncTex(): boolean {
    return this.synctex !== null;
  }
}
