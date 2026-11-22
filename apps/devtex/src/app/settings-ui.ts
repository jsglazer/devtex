/**
 * Minimal settings UI (decision): editor font face, font size and highlight
 * colours only. Everything else is edited in the JSONC files.
 */
import {
  formatCssColor,
  parseCssColor,
  toHex6,
  withPickedRgb,
  type Rgba,
  type Settings,
} from '@devtex/core';
import { el } from './ui.js';

/** Parse any CSS colour, letting the browser resolve named colours (e.g. "gold"). */
function resolveColor(value: string): Rgba | null {
  const direct = parseCssColor(value);
  if (direct !== null) return direct;
  if (!CSS.supports('color', value)) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return parseCssColor(computed);
}

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
      const input = el('input', {
        type: 'text',
        value: current.colors[k],
        'aria-label': `${COLOR_LABELS[k]} (CSS colour)`,
      });
      // Clicking the swatch opens the system colour wheel. <input type="color"> only edits
      // #rrggbb, so the picked RGB is combined with the opacity slider into rgba().
      const picker = el('input', {
        type: 'color',
        class: 'dt-swatch-input',
        title: 'Click to pick a colour',
      });
      const swatch = el('span', { class: 'dt-swatch' }, picker);
      const opacity = el('input', {
        type: 'range',
        min: '0',
        max: '100',
        step: '1',
        class: 'dt-opacity',
        title: 'Opacity',
      });
      const opacityLabel = el('span', { class: 'dt-opacity-label' });
      const sync = (): void => {
        const c = resolveColor(input.value);
        if (c === null) {
          input.classList.add('invalid');
          return;
        }
        input.classList.remove('invalid');
        picker.value = toHex6(c);
        opacity.value = String(Math.round(c.a * 100));
        opacityLabel.textContent = `${opacity.value}%`;
        swatch.style.setProperty('--swatch', input.value);
      };
      input.addEventListener('input', sync);
      picker.addEventListener('input', () => {
        input.value = withPickedRgb(
          resolveColor(input.value) === null ? '#000000' : input.value,
          picker.value,
        );
        const c = resolveColor(input.value);
        if (c !== null) input.value = formatCssColor({ ...c, a: Number(opacity.value) / 100 });
        sync();
      });
      opacity.addEventListener('input', () => {
        const c = resolveColor(input.value) ?? { r: 0, g: 0, b: 0, a: 1 };
        input.value = formatCssColor({ ...c, a: Number(opacity.value) / 100 });
        sync();
      });
      sync();
      return {
        k,
        input,
        row: el(
          'div',
          { class: 'dt-field row' },
          el('span', { class: 'dt-color-name' }, COLOR_LABELS[k]),
          swatch,
          opacity,
          opacityLabel,
          input,
        ),
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
