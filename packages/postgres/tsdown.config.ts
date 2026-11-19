import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  platform: 'node',
  // The core is a peer: the store must throw the same StaleRunError class the project's copy checks for.
  deps: { neverBundle: [/^typemaid(\/.*)?$/] },
});
