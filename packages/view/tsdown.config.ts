import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  platform: 'node',
  // The core is a peer: the viewer uses the copy the project already has.
  deps: { neverBundle: [/^typemaid(\/.*)?$/] },
});
