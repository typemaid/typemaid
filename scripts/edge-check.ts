/**
 * Checks the core where there is no Node: it is bundled for the browser and run inside an
 * empty sandbox that has only web-standard globals (no process, no require, no node: modules).
 * This is what a browser or an edge worker provides.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dir, '..');
const work = mkdtempSync(path.join(tmpdir(), 'edge-'));
try {
  const check = readFileSync(path.join(root, 'scripts/runtime-check.mjs'), 'utf8')
    .replaceAll("'../dist/", `'${root}/dist/`)
    .replace("from 'zod'", `from '${root}/node_modules/zod/index.js'`)
    .replace(/console\.log\(/, 'globalThis.__done(');
  writeFileSync(path.join(work, 'entry.mjs'), `globalThis.EDGE = true;\n${check}`);
  const built = await Bun.build({ entrypoints: [path.join(work, 'entry.mjs')], target: 'browser', format: 'esm' });
  if (!built.success) throw new Error(`bundling for the browser failed:\n${built.logs.join('\n')}`);
  let code = await built.outputs[0]!.text();
  const nodeImports = [...code.matchAll(/(?:from|import)\s*\(?\s*["'](node:[^"']+)["']/g)].map((m) => m[1]);
  if (nodeImports.length > 0) throw new Error(`the browser bundle statically imports ${[...new Set(nodeImports)].join(', ')}`);
  // Top-level await needs a module; wrap the bundle in an async function instead.
  code = `(async () => {\n${code.replace(/^export\s*\{[^}]*\};?\s*$/gm, '')}\n})()`;
  const result = await new Promise<string>((resolve, reject) => {
    const sandbox = {
      __done: resolve, crypto, AbortController, AbortSignal, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout,
      setInterval, clearInterval, structuredClone, Promise, console: { log() {}, warn() {}, error() {} }, navigator: { userAgent: 'edge-sandbox' },
    };
    (vm.runInNewContext(code, sandbox, { timeout: 20_000 }) as Promise<unknown>).catch(reject);
    setTimeout(() => reject(new Error('timed out')), 20_000);
  });
  console.log(result.replace(/^ok\s+\S+ \S+/, 'ok  browser/edge sandbox (no Node APIs)'));
  console.log(`    (bundle ${(code.length / 1024).toFixed(0)} KB unminified, with Zod and the AI SDK bundled in)`);
} catch (err) {
  const details = (err as { errors?: unknown[] }).errors?.map((e) => String((e as Error).message ?? e)).join('\n') ?? '';
  console.error(`FAILED browser/edge sandbox: ${(err as Error).message}${details ? `\n${details}` : ''}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
