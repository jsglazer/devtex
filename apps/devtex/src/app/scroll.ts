/**
 * Scroll `target` to the vertical centre of `container` by changing only the
 * container's own scroll offset. (Element.scrollIntoView also scrolls every
 * scrollable ancestor, including overflow:hidden ones, which can shift the
 * whole window layout.) Does nothing while the container is hidden.
 */
export function scrollWithin(
  container: HTMLElement,
  target: HTMLElement,
  onlyIfHidden: boolean,
): void {
  const c = container.getBoundingClientRect();
  if (c.height === 0) return;
  const r = target.getBoundingClientRect();
  if (onlyIfHidden && r.top >= c.top && r.bottom <= c.bottom) return;
  const top = container.scrollTop + (r.top - c.top) - (c.height - Math.min(r.height, c.height)) / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}
