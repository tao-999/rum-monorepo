import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { 'vue': 'src/index.ts' },
  format: ['esm', 'iife'],
  dts: true,
  minify: true,
  clean: true,
  globalName: 'RUMVue',
  target: 'es2020',
  treeshake: true
});
