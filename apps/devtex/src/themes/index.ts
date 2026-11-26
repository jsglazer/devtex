/**
 * The DevStyle profile families DevTex offers in View ▸ Style Profile (menu
 * id suffix -> light and dark profile ids). The profiles themselves come from
 * DevStyle (`@devstyle/web`'s built-ins, copied into the shared folder).
 */
export const BUILTIN_FAMILIES: Readonly<
  Record<string, { name: string; light: string; dark: string }>
> = {
  Default: { name: 'Default', light: 'default-light', dark: 'default-dark' },
  Paper: { name: 'Paper', light: 'paper-light', dark: 'paper-dark' },
  HighContrast: { name: 'High Contrast', light: 'high-contrast-light', dark: 'high-contrast-dark' },
  Solarized: { name: 'Solarized', light: 'solarized-light', dark: 'solarized-dark' },
};
