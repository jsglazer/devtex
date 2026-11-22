/**
 * Minimal settings UI (decision): editor font face, font size and highlight
 * colours only. Everything else is edited in the JSONC files.
 */
import type { Settings } from '@devtex/core';
import { el } from './ui.js';

const COLOR_LABELS: Record<keyof Settings['colors'], string> = {
  currentLine: 'Current line',
  matchingBracket: 'Matching bracket',
  brokenCode: 'Broken code',
  selectionMatch: 'Selection matches',
  environmentPair: 'Environment pair',
};

export function settingsDialog(current: Settings, configDir: string): Promise<Settings | null> {
  return new Promise((resolve) => {
    const next: Settings = structuredClone(current);
    const font = el('input', { type: 'text', value: current.editor.fontFamily });
    const size = el('input', {
      type: 'number',
      min: '6',
      max: '72',
      value: String(current.editor.fontSize),
    });
    const colorInputs = (Object.keys(COLOR_LABELS) as (keyof Settings['colors'])[]).map((k) => {
      const input = el('input', { type: 'text', value: current.colors[k] });
      const swatch = el('span', { class: 'dt-swatch', style: `background:${current.colors[k]}` });
      input.addEventListener('input', () => {
        swatch.style.background = input.value;
      });
      return {
        k,
        input,
        row: el('label', { class: 'dt-field row' }, COLOR_LABELS[k], swatch, input),
      };
    });
    const overlay = el('div', { class: 'dt-modal-overlay' });
    const save = el('button', { class: 'primary' }, 'Save');
    const cancel = el('button', {}, 'Cancel');
    const box = el(
      'div',
      { class: 'dt-modal' },
      el('h3', {}, 'Settings'),
      el('label', { class: 'dt-field' }, 'Editor font', font),
      el('label', { class: 'dt-field' }, 'Font size', size),
      el('div', { class: 'dt-muted' }, 'Highlight colours (any CSS colour)'),
      ...colorInputs.map((c) => c.row),
      el(
        'div',
        { class: 'dt-muted' },
        `Other options: settings.jsonc, keymap.json, toolbars.json and syntax/*.json in ${configDir}`,
      ),
      el('div', { class: 'dt-modal-buttons' }, cancel, save),
    );
    overlay.append(box);
    document.getElementById('modal-root')?.append(overlay);
    const done = (v: Settings | null): void => {
      overlay.remove();
      resolve(v);
    };
    cancel.addEventListener('click', () => done(null));
    save.addEventListener('click', () => {
      next.editor.fontFamily = font.value.trim() === '' ? current.editor.fontFamily : font.value;
      const n = Number(size.value);
      next.editor.fontSize = Number.isFinite(n) ? n : current.editor.fontSize;
      for (const c of colorInputs) next.colors[c.k] = c.input.value.trim();
      done(next);
    });
  });
}
