import { defineConfig } from 'vitest/config';

export default defineConfig({
  // css: true so `themes/*.css?raw` (the built-in style profiles) load their text in tests
  test: { include: ['src/**/*.test.ts'], environment: 'node', css: true },
});
