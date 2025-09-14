import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { svelte: 'src/index.ts' },
    format: ['esm'],
    target: 'es2020',
    sourcemap: true,
    dts: true,
    clean: true
  },
  // 可选：给 <script> 直接用（全局 window.RUMSvelte），不打 dts
  {
    entry: { 'svelte.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'RUMSvelte',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    clean: false,
    dts: false
  }
]);
