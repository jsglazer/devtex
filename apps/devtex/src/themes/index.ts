/**
 * Built-in style profiles, shipped inside the app. The first time one is used
 * it is copied into the config folder's themes/ so it can be edited; a file
 * already there is never overwritten.
 */
import defaultDark from './Default Dark.css?raw';
import defaultLight from './Default Light.css?raw';
import highContrastDark from './High Contrast Dark.css?raw';
import highContrastLight from './High Contrast Light.css?raw';
import paperDark from './Paper Dark.css?raw';
import paperLight from './Paper Light.css?raw';
import solarizedDark from './Solarized Dark.css?raw';
import solarizedLight from './Solarized Light.css?raw';

export const BUILTIN_PROFILES: Readonly<Record<string, string>> = {
  'Default Light': defaultLight,
  'Default Dark': defaultDark,
  'Paper Light': paperLight,
  'Paper Dark': paperDark,
  'High Contrast Light': highContrastLight,
  'High Contrast Dark': highContrastDark,
  'Solarized Light': solarizedLight,
  'Solarized Dark': solarizedDark,
};

/** Families for View ▸ Style Profile (menu id suffix -> family name). */
export const BUILTIN_FAMILIES: Readonly<Record<string, string>> = {
  Default: 'Default',
  Paper: 'Paper',
  HighContrast: 'High Contrast',
  Solarized: 'Solarized',
};
