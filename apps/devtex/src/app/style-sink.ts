/**
 * DOM side of style profiles: the profile and user.css live in their own
 * `<style>` elements after styles.css, wrapped in `@layer profile` and
 * `@layer user` (the order styles.css declares), and the active profile's
 * appearance header drives `color-scheme` and the native window appearance.
 */
import { wrapInLayer, type Appearance } from '@devtex/core';
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
  // created in this order so user.css always follows the profile
  const profile = styleElement('dt-profile');
  const user = styleElement('dt-user');
  return {
    setProfile: (css) => {
      profile.textContent = wrapInLayer(css, 'profile');
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
