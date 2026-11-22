/**
 * @devtex/core — platform-agnostic DevTex logic. Zero imports from
 * @tauri-apps/*, obsidian, or the browser DOM (enforced by tsconfig lib
 * ["ES2022"] with no DOM types, by ESLint no-restricted-imports/globals, and
 * by tests/purity.test.ts).
 *
 * The HTML preview renderer is exported separately from "@devtex/core/render"
 * because it pulls in unified-latex and MathJax and is only loaded inside the
 * preview Web Worker.
 */
export * from './text.js';
export * from './hash.js';
export * from './magic.js';
export * from './project.js';
export * from './macros.js';
export * from './blocks.js';
export * from './sourcemap.js';
export * from './latexlog.js';
export * from './synctex.js';
export * from './matching.js';
export * from './autoitem.js';
export * from './completion-data.js';
export * from './completion.js';
export * from './diagnostics.js';
export * from './outline.js';
export * from './bibtex.js';
export * from './bbt.js';
export * from './conflict.js';
export * from './push.js';
export * from './debounce.js';
export * from './ports.js';
export * from './config/settings.js';
export * from './config/keymap.js';
export * from './config/toolbars.js';
export * from './config/syntax.js';
