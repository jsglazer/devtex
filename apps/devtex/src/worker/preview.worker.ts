/**
 * Preview Web Worker: all LaTeX parsing (unified-latex) and math typesetting
 * (MathJax liteDOM SVG) run here, never on the UI thread. Messages that
 * arrive while a render is pending coalesce into one render.
 */
import { IncrementalRenderer, MathJaxRenderer } from '@devtex/core/render';
import type { FromWorker, ToWorker } from './protocol.js';

const files = new Map<string, string>();
let root = '';
let seq = 0;
let scheduled = false;
let renderer = new IncrementalRenderer({
  math: new MathJaxRenderer(),
  now: () => performance.now(),
});
const pendingVisible = new Set<string>();

function post(m: FromWorker): void {
  self.postMessage(m);
}

function render(): void {
  scheduled = false;
  if (root === '' || !files.has(root)) return;
  try {
    const update = renderer.update({ root, files });
    post({ type: 'rendered', seq: ++seq, update });
    flushVisible();
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

function flushVisible(): void {
  if (pendingVisible.size === 0) return;
  const ids = [...pendingVisible];
  pendingVisible.clear();
  const changes = renderer.typesetPending(ids);
  if (changes.length > 0) post({ type: 'typeset', changes });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'files') {
    root = m.root;
    for (const [p, t] of m.files) files.set(p, t);
    for (const p of m.removed ?? []) files.delete(p);
    if (!scheduled) {
      scheduled = true;
      setTimeout(render, 0); // coalesce bursts of messages
    }
  } else if (m.type === 'visible') {
    for (const id of m.ids) pendingVisible.add(id);
    if (!scheduled) flushVisible();
  } else {
    files.clear();
    root = '';
    renderer = new IncrementalRenderer({
      math: new MathJaxRenderer(),
      now: () => performance.now(),
    });
  }
};
