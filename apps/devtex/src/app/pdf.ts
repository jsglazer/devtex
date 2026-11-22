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
  type SyncTexData,
} from '@devtex/core';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PageView {
  wrap: HTMLElement;
  scale: number;
  heightPt: number;
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
  ) {}

  async load(
    bytes: Uint8Array,
    synctexBytes: Uint8Array | null,
    baseDirAbs: string,
    projectRootAbs: string,
  ): Promise<void> {
    this.baseDir = baseDirAbs;
    this.projectRoot = projectRootAbs;
    this.synctex = synctexBytes ? parseSyncTex(decodeSyncTex(synctexBytes)) : null;
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const scroll = this.container.scrollTop;
    this.container.replaceChildren();
    this.pages = [];
    const width = Math.max(300, this.container.clientWidth - 24);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const vp = page.getViewport({ scale: scale * window.devicePixelRatio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${Math.floor(base.width * scale)}px`;
      canvas.style.height = `${Math.floor(base.height * scale)}px`;
      const wrap = document.createElement('div');
      wrap.className = 'dt-pdf-page';
      wrap.dataset['page'] = String(i);
      wrap.append(canvas);
      this.container.append(wrap);
      const ctx = canvas.getContext('2d');
      if (ctx) await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const pv: PageView = { wrap, scale, heightPt: base.height };
      this.pages.push(pv);
      wrap.addEventListener('click', (ev) => this.onClick(ev, i, pv));
    }
    this.container.scrollTop = scroll;
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
      this.drawMarker(pv, x, y, null);
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
    this.drawMarker(pv, loc.x, loc.y, loc.rect ?? null);
    pv.wrap.scrollIntoView({ block: 'nearest' });
    this.overlay?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  private drawMarker(
    pv: PageView,
    x: number,
    y: number,
    r: { left: number; top: number; right: number; bottom: number } | null,
  ): void {
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
