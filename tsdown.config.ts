import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', ai: 'src/ai/index.ts', sqlite: 'src/sqlite/index.ts', node: 'src/node/index.ts', cli: 'src/cli.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  platform: 'node',
  deps: { neverBundle: ['ai', 'zod'] },
});
