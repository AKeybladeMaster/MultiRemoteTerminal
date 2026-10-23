import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/desktop', base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true, sourcemap: false },
  esbuild: { jsx: 'automatic' }
});
