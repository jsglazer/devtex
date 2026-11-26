/**
 * Settings dialog: "Follow shared style / Use my own", the light/dark
 * DevStyle profiles, plus quick editor font,
 * size and highlight-colour controls. The quick controls never rewrite a
 * profile: changed values are saved as variable overrides in the
 * DevTex-managed block of themes/user.css. Everything else is edited in the
 * JSONC/CSS files in the config folder (path and Open button at the bottom).
 */
import type { ProfileInfo } from '@devstyle/web';
import { formatCssColor, parseCssColor, toHex6, withPickedRgb, type Rgba } from '@devtex/core';
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

/** Highlight colours editable in the dialog (variable -> label). */
export const COLOR_VARIABLES: Readonly<Record<string, string>> = {
  '--dt-editor-active-line': 'Current line',
  '--dt-editor-matching-bracket': 'Matching bracket',
  '--dt-editor-broken': 'Broken code',
  '--dt-editor-selection-match': 'Selection matches',
  '--dt-editor-env-pair': 'Environment pair',
};

export interface SettingsDialogInput {
  /** `ui.followSharedStyle`. */
  follow: boolean;
  /** False where there is no shared DevStyle folder (iOS): the follow switch is hidden. */
  canShare: boolean;
  /** The shared choice (devstyle.json) every following app uses. */
  shared: { light: string; dark: string };
  /** DevTex's own choice (`ui.theme` / `ui.themeDark`). */
  theme: string;
  themeDark: string;
  /** Every selectable DevStyle profile. */
  profiles: readonly ProfileInfo[];
  /** Where the shared folder is (shown in the dialog), or null. */
  sharedLocation: string | null;
  /** Current overrides in user.css (managed block). */
  overrides: ReadonlyMap<string, string>;
  /** Value a variable has right now (profile + overrides). */
  current: (variable: string) => string;
  configDir: string;
  /** Null when the platform cannot open the folder (iOS). */
  openConfigFolder: (() => void) | null;
}

export interface SettingsDialogResult {
  follow: boolean;
  /** The light/dark ids picked: the shared choice when `follow`, else DevTex's own. */
  theme: string;
  themeDark: string;
  overrides: Map<string, string>;
}

/**
 * Overrides after the dialog: a field the user changed becomes (or replaces)
 * an override, a field they cleared drops it, untouched fields keep whatever
 * override they had. Pure, so it is unit-tested.
 */
export function nextOverrides(
  before: ReadonlyMap<string, string>,
  fields: readonly { variable: string; initial: string; value: string }[],
): Map<string, string> {
  const out = new Map(before);
  for (const f of fields) {
    const v = f.value.trim();
    if (v === f.initial.trim()) continue;
    if (v === '') out.delete(f.variable);
    else out.set(f.variable, v);
  }
  return out;
}

/**
 * Options for one slot: profiles of that appearance first, then the others
 * (allowed, e.g. a dark profile in light mode), plus the current value if it
 * is not in the list. Pure, so it is unit-tested.
 */
export function profileOptions(
  profiles: readonly ProfileInfo[],
  slot: 'light' | 'dark',
  value: string,
): { value: string; label: string }[] {
  const mine = profiles.filter((p) => p.appearance === slot);
  const others = profiles.filter((p) => p.appearance !== slot);
  const out = [...mine, ...others].map((p) => ({
    value: p.id,
    label: p.appearance === slot ? p.name : `${p.name} (${p.appearance})`,
  }));
  if (!out.some((o) => o.value === value)) out.push({ value, label: `${value} (missing)` });
  return out;
}

function profileSelect(
  profiles: readonly ProfileInfo[],
  slot: 'light' | 'dark',
  value: string,
  label: string,
): HTMLSelectElement & { fill(value: string): void } {
  const s = el('select', { 'aria-label': label });
  const fill = (v: string): void => {
    s.replaceChildren(
      ...profileOptions(profiles, slot, v).map((o) => el('option', { value: o.value }, o.label)),
    );
    s.value = v;
  };
  fill(value);
  return Object.assign(s, { fill });
}

export function settingsDialog(input: SettingsDialogInput): Promise<SettingsDialogResult | null> {
  return new Promise((resolve) => {
    const shareable = input.canShare;
    let follow = shareable && input.follow;
    const initial = (f: boolean): { light: string; dark: string } =>
      f ? input.shared : { light: input.theme, dark: input.themeDark };
    const light = profileSelect(input.profiles, 'light', initial(follow).light, 'Light profile');
    const dark = profileSelect(input.profiles, 'dark', initial(follow).dark, 'Dark profile');
    const followBox = el('input', { type: 'checkbox' });
    followBox.checked = follow;
    const followHint = el('div', { class: 'dt-muted' });
    const showHint = (): void => {
      followHint.textContent = follow
        ? 'Following the shared style: changing these profiles changes every app that follows it.'
        : 'Using DevTex’s own profiles: other apps are not affected.';
    };
    showHint();
    followBox.addEventListener('change', () => {
      follow = followBox.checked;
      const v = initial(follow);
      light.fill(v.light);
      dark.fill(v.dark);
      showHint();
    });
    const followRow = shareable
      ? [
          el(
            'label',
            { class: 'dt-field row' },
            followBox,
            el('span', {}, 'Follow shared style (all DevStyle apps)'),
          ),
          followHint,
        ]
      : [];
    const fields: { variable: string; initial: string; input: HTMLInputElement }[] = [];
    const fontInitial = input.current('--dt-editor-font');
    const font = el('input', { type: 'text', value: fontInitial });
    fields.push({ variable: '--dt-editor-font', initial: fontInitial, input: font });
    const sizeInitial = input.current('--dt-editor-size').replace(/px$/, '');
    const size = el('input', { type: 'number', min: '6', max: '72', value: sizeInitial });
    const colorRows = Object.entries(COLOR_VARIABLES).map(([variable, label]) => {
      const initial = input.current(variable);
      const text = el('input', {
        type: 'text',
        value: initial,
        'aria-label': `${label} (CSS colour)`,
      });
      fields.push({ variable, initial, input: text });
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
        const c = resolveColor(text.value);
        if (c === null) {
          text.classList.toggle('invalid', text.value.trim() !== '');
          return;
        }
        text.classList.remove('invalid');
        picker.value = toHex6(c);
        opacity.value = String(Math.round(c.a * 100));
        opacityLabel.textContent = `${opacity.value}%`;
        swatch.style.setProperty('--swatch', text.value);
      };
      text.addEventListener('input', sync);
      picker.addEventListener('input', () => {
        text.value = withPickedRgb(
          resolveColor(text.value) === null ? '#000000' : text.value,
          picker.value,
        );
        const c = resolveColor(text.value);
        if (c !== null) text.value = formatCssColor({ ...c, a: Number(opacity.value) / 100 });
        sync();
      });
      opacity.addEventListener('input', () => {
        const c = resolveColor(text.value) ?? { r: 0, g: 0, b: 0, a: 1 };
        text.value = formatCssColor({ ...c, a: Number(opacity.value) / 100 });
        sync();
      });
      sync();
      return el(
        'div',
        { class: 'dt-field row' },
        el('span', { class: 'dt-color-name' }, label),
        swatch,
        opacity,
        opacityLabel,
        text,
      );
    });
    let clearAll = false;
    const clear = el(
      'button',
      { class: 'link', title: 'Remove every override saved by this dialog' },
      'Reset to profile',
    );
    clear.addEventListener('click', () => {
      clearAll = true;
      for (const f of fields) f.input.value = '';
      size.value = '';
      clear.textContent = 'Overrides will be cleared on Save';
    });
    const path = el(
      'span',
      { class: 'dt-config-path', title: 'Config folder (selectable)' },
      input.configDir,
    );
    const openBtn = input.openConfigFolder === null ? null : el('button', {}, 'Open Config Folder');
    if (openBtn !== null && input.openConfigFolder !== null) {
      const openFolder = input.openConfigFolder;
      openBtn.addEventListener('click', () => openFolder());
    }
    const overlay = el('div', { class: 'dt-modal-overlay' });
    const save = el('button', { class: 'primary' }, 'Save');
    const cancel = el('button', {}, 'Cancel');
    const box = el(
      'div',
      { class: 'dt-modal' },
      el('h3', {}, 'Settings'),
      el(
        'div',
        { class: 'dt-muted' },
        'Style profile (DevStyle; follows the system light/dark setting)',
      ),
      ...followRow,
      el(
        'label',
        { class: 'dt-field row' },
        el('span', { class: 'dt-color-name' }, 'Light profile'),
        light,
      ),
      el(
        'label',
        { class: 'dt-field row' },
        el('span', { class: 'dt-color-name' }, 'Dark profile'),
        dark,
      ),
      el(
        'div',
        { class: 'dt-muted' },
        'Overrides (saved in themes/user.css; apply on top of any profile)',
      ),
      el('label', { class: 'dt-field' }, 'Editor font', font),
      el('label', { class: 'dt-field' }, 'Font size (px)', size),
      ...colorRows,
      clear,
      el(
        'div',
        { class: 'dt-muted' },
        'Config folder: settings.jsonc, keymap.json, toolbars.json, syntax/*.json and themes/user.css',
      ),
      el('div', { class: 'dt-field row' }, path, ...(openBtn === null ? [] : [openBtn])),
      ...(input.sharedLocation === null
        ? []
        : [
            el('div', { class: 'dt-muted' }, 'DevStyle profiles (shared by all apps):'),
            el(
              'div',
              { class: 'dt-field row' },
              el(
                'span',
                { class: 'dt-config-path', title: 'DevStyle folder (selectable)' },
                input.sharedLocation,
              ),
            ),
          ]),
      el('div', { class: 'dt-modal-buttons' }, cancel, save),
    );
    overlay.append(box);
    document.getElementById('modal-root')?.append(overlay);
    const done = (v: SettingsDialogResult | null): void => {
      overlay.remove();
      resolve(v);
    };
    cancel.addEventListener('click', () => done(null));
    save.addEventListener('click', () => {
      const n = Number(size.value);
      const sizeValue =
        size.value.trim() === ''
          ? ''
          : Number.isFinite(n) && n >= 6 && n <= 72
            ? String(n)
            : sizeInitial;
      const entries = [
        ...fields.map((f) => ({ variable: f.variable, initial: f.initial, value: f.input.value })),
        {
          variable: '--dt-editor-size',
          initial: `${sizeInitial}px`,
          value: sizeValue === '' ? '' : `${sizeValue}px`,
        },
      ];
      done({
        follow,
        theme: light.value,
        themeDark: dark.value,
        overrides: clearAll
          ? nextOverrides(
              new Map(),
              entries.filter((e) => e.value !== ''),
            )
          : nextOverrides(input.overrides, entries),
      });
    });
  });
}
