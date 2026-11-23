/**
 * Draggable divider between the editor and the right-hand (Preview/PDF) pane.
 * The split is stored as the editor's share of the space (0.15–0.85) in
 * localStorage, so it survives restarts and scales with the window. Works for
 * the side-by-side layout and the stacked (narrow / iPhone) layout.
 * Double-click the divider to reset to 50/50.
 */
const KEY = 'devtex.split';
const MIN = 0.15;
const MAX = 0.85;

export function clampSplit(f: number): number {
  return Number.isFinite(f) ? Math.min(MAX, Math.max(MIN, f)) : 0.5;
}

export function initSplitter(
  splitter: HTMLElement,
  first: HTMLElement,
  second: HTMLElement,
  onChange?: () => void,
): void {
  const container = splitter.parentElement;
  if (container === null) return;
  const apply = (f: number): void => {
    const v = clampSplit(f);
    first.style.flex = `${v} 1 0`;
    second.style.flex = `${1 - v} 1 0`;
  };
  const saved = Number(localStorage.getItem(KEY) ?? '0.5');
  apply(saved);

  const vertical = (): boolean => getComputedStyle(container).flexDirection.startsWith('column');
  let dragging = false;
  splitter.addEventListener('pointerdown', (ev) => {
    if (second.hidden) return;
    dragging = true;
    splitter.setPointerCapture(ev.pointerId);
    document.body.classList.add('dt-resizing');
    ev.preventDefault();
  });
  splitter.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const f = vertical()
      ? (ev.clientY - a.top) / (b.bottom - a.top)
      : (ev.clientX - a.left) / (b.right - a.left);
    apply(f);
  });
  const end = (ev: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    splitter.releasePointerCapture(ev.pointerId);
    document.body.classList.remove('dt-resizing');
    const grow = Number.parseFloat(first.style.flex);
    localStorage.setItem(KEY, String(clampSplit(grow)));
    onChange?.();
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  splitter.addEventListener('dblclick', () => {
    apply(0.5);
    localStorage.setItem(KEY, '0.5');
    onChange?.();
  });
}
