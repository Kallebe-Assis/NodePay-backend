import { defineConfig } from 'tsup';

/**
 * Build da API: um único bundle ESM em `dist/main.js`.
 * `@nodepay/shared` é código local (pasta `./shared`), então entra no bundle
 * em vez de virar dependência externa.
 */
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/@nodepay\/shared/],
  dts: false,
});
