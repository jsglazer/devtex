import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';
// Obsidian provides obsidian, electron and the CodeMirror 6 / Lezer packages at runtime.
const external = [
  'obsidian',
  'electron',
  '@codemirror/autocomplete',
  '@codemirror/collab',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  ...builtinModules,
];
const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external,
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'dist/main.js',
  // keep the preview renderer (unified-latex/MathJax) out of the plugin bundle
  alias: {},
});
if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
