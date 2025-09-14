// packages/rum-core/tsup.config.ts
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { rum: 'src/index.ts' },
  format: ['esm','iife'],
  dts: true,
  minify: true,
  clean: true,
  globalName: 'RUM',
  target: 'es2020',
  tsconfig: './tsconfig.json',   // 👈 加这行
});
