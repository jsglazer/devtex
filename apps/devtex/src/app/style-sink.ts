/**
 * DOM side of style profiles. styles.css declares the layer order
 * (`@layer cm, app-base, ds-profile, app-override, user`); this adds, after it:
 * the `--dt-*` → `--ds-*` aliases (`@layer app-base`), the DevStyle profile
 * (`@layer ds-profile`) and themes/user.css (`@layer user`), each in its own
 * `<style>` element. The profile's appearance drives `color-scheme` and the
 * native window appearance.
 */
import { aliasStylesheet, wrapInLayer, type Appearance } from '@devtex/core';
import type { StyleSink } from './profiles.js';

function styleElement(id: string): HTMLStyleElement {
  const found = document.getElementById(id);
  if (found instanceof HTMLStyleElement) return found;
  const el = document.createElement('style');
  el.id = id;
  document.head.append(el);
  return el;
}

export function domStyleSink(setWindow: (a: Appearance | null) => Promise<void>): StyleSink {
  // created in this order (the layers decide precedence, the order keeps it readable)
  styleElement('dt-aliases').textContent = wrapInLayer(aliasStylesheet(), 'app-base');
  const profile = styleElement('dt-profile');
  const user = styleElement('dt-user');
  return {
    setProfile: (css) => {
      profile.textContent = wrapInLayer(css, 'ds-profile');
    },
    setUser: (css) => {
      user.textContent = css.trim() === '' ? '' : wrapInLayer(css, 'user');
    },
    setAppearance: (own, forced) => {
      const root = document.documentElement;
      if (own === null) delete root.dataset['appearance'];
      else root.dataset['appearance'] = own;
      void setWindow(forced);
    },
  };
}
