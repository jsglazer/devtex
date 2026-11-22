/**
 * In-page dialogs and notices. No browser alert/confirm/prompt (they block
 * WKWebView); every dialog is a promise-returning modal.
 */
import type { ConflictChoice, DiffLine } from '@devtex/core';

const root = (): HTMLElement => document.getElementById('modal-root') ?? document.body;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export { el };

interface ModalButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  /** Triggered by Enter (default action). */
  isDefault?: boolean;
}

function modal<T>(
  title: string,
  body: Node,
  buttons: ModalButton<T>[],
  cancelValue: T,
  onOpen?: () => void,
): Promise<T> {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'dt-modal-overlay' });
    const box = el('div', { class: 'dt-modal', role: 'dialog', 'aria-label': title });
    const bar = el('div', { class: 'dt-modal-buttons' });
    const close = (v: T): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close(cancelValue);
      } else if (ev.key === 'Enter' && !(ev.target instanceof HTMLTextAreaElement)) {
        const def = buttons.find((b) => b.isDefault);
        if (def) {
          ev.preventDefault();
          close(def.value);
        }
      }
    };
    for (const b of buttons) {
      const btn = el('button', { class: b.primary ? 'primary' : '' }, b.label);
      btn.addEventListener('click', () => close(b.value));
      bar.append(btn);
    }
    box.append(el('h3', {}, title), body, bar);
    overlay.append(box);
    root().append(overlay);
    document.addEventListener('keydown', onKey, true);
    onOpen?.();
    const def = buttons.findIndex((b) => b.isDefault);
    const btns = bar.querySelectorAll('button');
    if (def >= 0 && !onOpen) btns[def]?.focus();
  });
}

export function confirmDialog(
  title: string,
  text: string,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
): Promise<boolean> {
  return modal(
    title,
    el('p', { class: 'dt-pre' }, text),
    [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, primary: true, isDefault: true },
    ],
    false,
  );
}

/** Proceed / Abort, with Abort as the default (Enter) action. */
export function proceedOrAbort(title: string, text: string): Promise<boolean> {
  return modal(
    title,
    el('p', { class: 'dt-pre' }, text),
    [
      { label: 'Proceed', value: true },
      { label: 'Abort', value: false, primary: true, isDefault: true },
    ],
    false,
  );
}

export function promptDialog(
  title: string,
  label: string,
  value: string,
  opts: { multiline?: boolean; secret?: boolean; okLabel?: string } = {},
): Promise<string | null> {
  const input: HTMLInputElement | HTMLTextAreaElement =
    opts.multiline === true
      ? el('textarea', { rows: '3' })
      : el('input', { type: opts.secret === true ? 'password' : 'text' });
  input.value = value;
  const body = el('label', { class: 'dt-field' }, label, input);
  let result: string | null = null;
  return modal<'ok' | 'cancel'>(
    title,
    body,
    [
      { label: 'Cancel', value: 'cancel' },
      { label: opts.okLabel ?? 'OK', value: 'ok', primary: true, isDefault: true },
    ],
    'cancel',
    () => {
      input.focus();
      input.select();
    },
  ).then((v) => {
    result = v === 'ok' ? input.value : null;
    return result;
  });
}

export function messageApproval(defaultMessage: string, files: string[]): Promise<string | null> {
  const input = el('textarea', { rows: '3' });
  input.value = defaultMessage;
  const list = el('ul', { class: 'dt-file-list' }, ...files.map((f) => el('li', {}, f)));
  const body = el(
    'div',
    {},
    el('label', { class: 'dt-field' }, 'Commit message', input),
    el('div', { class: 'dt-muted' }, `${files.length} file(s), one commit:`),
    list,
  );
  return modal<'ok' | 'cancel'>(
    'Push for review',
    body,
    [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Approve & Push', value: 'ok', primary: true, isDefault: true },
    ],
    'cancel',
    () => input.focus(),
  ).then((v) => (v === 'ok' ? input.value : null));
}

export function conflictDialog(path: string, diff: DiffLine[]): Promise<ConflictChoice> {
  const pre = el('pre', { class: 'dt-diff', hidden: '' });
  for (const d of diff) {
    const line = el(
      'div',
      { class: d.op === '+' ? 'add' : d.op === '-' ? 'del' : 'ctx' },
      `${d.op === ' ' ? ' ' : d.op} ${d.text}`,
    );
    pre.append(line);
  }
  const toggle = el('button', { class: 'link' }, 'Show diff (− yours, + on disk)');
  toggle.addEventListener('click', () => {
    pre.hidden = !pre.hidden;
  });
  const body = el(
    'div',
    {},
    el(
      'p',
      {},
      `${path} changed on disk (Obsidian or Obsidian Sync) while you have unsaved edits. DevTex has not overwritten anything.`,
    ),
    toggle,
    pre,
  );
  return modal<ConflictChoice>(
    'File changed on disk',
    body,
    [
      { label: 'Load disk version', value: 'loadDisk' },
      { label: 'Keep mine', value: 'keepMine', primary: true },
    ],
    'keepMine',
  );
}

export interface PickItem {
  label: string;
  detail?: string;
  value: string;
}

/** Filterable list (palette). */
export function pickDialog(title: string, items: PickItem[]): Promise<string | null> {
  const input = el('input', { type: 'text', placeholder: 'Filter…' });
  const list = el('ul', { class: 'dt-pick' });
  let filtered = items;
  let sel = 0;
  let done: ((v: string | null) => void) | null = null;
  const render = (): void => {
    list.replaceChildren(
      ...filtered.map((it, i) => {
        const li = el(
          'li',
          { class: i === sel ? 'sel' : '' },
          it.label,
          it.detail !== undefined ? el('span', { class: 'dt-muted' }, ` ${it.detail}`) : '',
        );
        li.addEventListener('click', () => done?.(it.value));
        return li;
      }),
    );
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    filtered = items.filter(
      (i) => i.label.toLowerCase().includes(q) || (i.detail ?? '').toLowerCase().includes(q),
    );
    sel = 0;
    render();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') sel = Math.min(sel + 1, filtered.length - 1);
    else if (ev.key === 'ArrowUp') sel = Math.max(sel - 1, 0);
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      const it = filtered[sel];
      if (it) done?.(it.value);
      return;
    } else return;
    ev.preventDefault();
    render();
  });
  render();
  return new Promise((resolve) => {
    const p = modal<string | null>(
      title,
      el('div', {}, input, list),
      [{ label: 'Cancel', value: null }],
      null,
      () => input.focus(),
    );
    done = (v) => {
      document.querySelector('.dt-modal-overlay:last-child')?.remove();
      resolve(v);
    };
    void p.then(resolve);
  });
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
export function notice(text: string, ms = 5000): void {
  let n = document.getElementById('dt-notice');
  if (n === null) {
    n = el('div', { id: 'dt-notice', role: 'status' });
    document.body.append(n);
  }
  n.textContent = text;
  n.classList.add('show');
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => n?.classList.remove('show'), ms);
}
