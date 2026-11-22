/**
 * Zoom steps shared by the interface zoom (⌘+ / ⌘−) and the PDF pane zoom.
 */

export const ZOOM_STEPS = [
  0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
] as const;

export function clampZoom(z: number, min = 0.5, max = 4): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(max, Math.max(min, z));
}

/** Next step above (dir 1) or below (dir -1) the current zoom, within [min, max]. */
export function stepZoom(current: number, dir: 1 | -1, min = 0.5, max = 4): number {
  const steps = ZOOM_STEPS.filter((s) => s >= min && s <= max);
  const eps = 1e-6;
  if (dir === 1) return steps.find((s) => s > current + eps) ?? clampZoom(current, min, max);
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s !== undefined && s < current - eps) return s;
  }
  return clampZoom(current, min, max);
}

export function formatZoom(z: number): string {
  return `${Math.round(z * 100)}%`;
}
