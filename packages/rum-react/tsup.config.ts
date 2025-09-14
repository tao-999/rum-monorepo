import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { 'react': 'src/index.ts' },
  format: ['esm', 'iife'],
  dts: true,
  minify: true,
  clean: true,
  globalName: 'RUMReact',
  target: 'es2020',
  treeshake: true
});
