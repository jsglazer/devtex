/** Outline, problems, toolbars, file tabs, status bar and the iOS keyboard accessory bar. */
import {
  isSeparator,
  type Diagnostic,
  type LogEntry,
  type OutlineItem,
  type Toolbar,
} from '@devtex/core';
import type { RenderTimings } from '@devtex/core/render';
import type { CommandRegistry } from './commands.js';
import { el } from './ui.js';

export function renderOutline(
  container: HTMLElement,
  items: OutlineItem[],
  onPick: (file: string, line: number) => void,
): void {
  const list = el('ul', { class: 'dt-outline' });
  for (const it of items) {
    const label =
      it.kind === 'section'
        ? it.title
        : it.kind === 'frame'
          ? `▭ ${it.title}`
          : it.kind === 'label'
            ? `🏷 ${it.title}`
            : `${it.kind === 'figure' ? '🖼' : '▦'} ${it.title}`;
    const li = el(
      'li',
      {
        class: `dt-ol-${it.kind}`,
        style: `padding-left:${it.kind === 'section' || it.kind === 'frame' ? it.level * 10 : 70}px`,
        title: `${it.file}:${it.line}`,
      },
      label,
    );
    li.addEventListener('click', () => onPick(it.file, it.line));
    list.append(li);
  }
  container.replaceChildren(el('div', { class: 'dt-pane-title' }, 'Outline'), list);
}

export interface Problem {
  severity: 'error' | 'warning' | 'info' | 'typesetting';
  file: string;
  line: number;
  message: string;
  source: string;
}

export function problemsFromLog(
  entries: LogEntry[],
  toRel: (abs: string) => string | null,
): Problem[] {
  // Info entries (package/font info) are noise in the Problems list.
  return entries.flatMap((e) => {
    if (e.type === 'info') return [];
    const file = toRel(e.file) ?? e.file;
    return [{ severity: e.type, file, line: e.line, message: e.text.trim(), source: 'latexmk' }];
  });
}

export function problemsFromDiagnostics(
  file: string,
  text: string,
  diags: Diagnostic[],
): Problem[] {
  return diags.map((d) => ({
    severity: d.severity,
    file,
    line: text.slice(0, d.from).split('\n').length,
    message: d.message,
    source: d.source,
  }));
}

export function renderProblems(
  container: HTMLElement,
  groups: { title: string; problems: Problem[] }[],
  onPick: (file: string, line: number) => void,
): void {
  const children: Node[] = [el('div', { class: 'dt-pane-title' }, 'Problems')];
  for (const g of groups) {
    if (g.problems.length === 0) continue;
    children.push(el('div', { class: 'dt-problem-group' }, `${g.title} (${g.problems.length})`));
    const ul = el('ul', { class: 'dt-problems' });
    for (const p of g.problems) {
      const li = el(
        'li',
        { class: `sev-${p.severity}` },
        el('span', { class: 'dt-loc' }, `${p.file}:${p.line}`),
        ` ${p.message}`,
      );
      li.addEventListener('click', () => onPick(p.file, p.line));
      ul.append(li);
    }
    children.push(ul);
  }
  if (children.length === 1) children.push(el('div', { class: 'dt-muted' }, 'No problems.'));
  container.replaceChildren(...children);
}

export function renderToolbars(
  container: HTMLElement,
  bars: Toolbar[],
  commands: CommandRegistry,
  allHidden: boolean,
): void {
  container.replaceChildren();
  container.hidden = allHidden;
  for (const bar of bars) {
    if (!bar.visible) continue;
    const div = el('div', { class: 'dt-toolbar', 'data-toolbar': bar.id, title: bar.title });
    let pendingSep = false;
    for (const item of bar.items) {
      if (isSeparator(item)) {
        // collapse leading, trailing and repeated dividers (e.g. around unavailable commands)
        pendingSep = div.childElementCount > 0;
        continue;
      }
      if (!commands.isAvailable(item.command)) continue;
      if (pendingSep) div.append(el('span', { class: 'dt-tb-sep', 'aria-hidden': 'true' }));
      pendingSep = false;
      const b = el(
        'button',
        { title: commands.title(item.command) },
        item.label ?? commands.title(item.command),
      );
      b.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep editor focus
      b.addEventListener('click', () => commands.run(item.command));
      div.append(b);
    }
    container.append(div);
  }
}

export function renderTabs(
  container: HTMLElement,
  files: string[],
  current: string,
  dirty: (f: string) => boolean,
  onPick: (f: string) => void,
): void {
  container.replaceChildren(
    ...files.map((f) => {
      const b = el(
        'button',
        { class: f === current ? 'active' : '', title: f },
        `${f.split('/').pop() ?? f}${dirty(f) ? ' ●' : ''}`,
      );
      b.addEventListener('click', () => onPick(f));
      return b;
    }),
  );
}

export function formatHud(
  t: RenderTimings,
  stats: { rerendered: number; typeset: number },
): string {
  return `parse ${t.parseMs.toFixed(1)} ms · render ${t.renderMs.toFixed(1)} ms · typeset ${t.typesetMs.toFixed(1)} ms · ${stats.rerendered} block(s)`;
}

/** iOS keyboard accessory bar: \ { } $ _ ^ & plus Tab. */
export const ACCESSORY_KEYS = ['\\', '{', '}', '$', '_', '^', '&', '[', ']', '%', '~'];

export function renderAccessory(
  container: HTMLElement,
  insert: (s: string) => void,
  extra: { label: string; run: () => void }[],
): void {
  container.replaceChildren(
    ...ACCESSORY_KEYS.map((k) => {
      const b = el('button', {}, k);
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('touchstart', (ev) => ev.preventDefault(), { passive: false });
      const fire = (): void => insert(k);
      b.addEventListener('click', fire);
      b.addEventListener('touchend', fire);
      return b;
    }),
    ...extra.map((x) => {
      const b = el('button', { class: 'wide' }, x.label);
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', x.run);
      return b;
    }),
  );
}
