// A program that uses the built package the way an application would. It is run unchanged on
// every runtime we claim to support (see scripts/runtimes.sh). Plain JavaScript on purpose.
import { z } from 'zod';
import { compile, human, memoryStore, resume, run, tool } from '../dist/index.mjs';
import { defineAI } from '../dist/ai.mjs';

const assert = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
};
const runtime = globalThis.Bun ? `bun ${Bun.version}` : globalThis.Deno ? `deno ${Deno.version.deno}` : typeof process !== 'undefined' ? `node ${process.versions.node}` : 'no-node sandbox';

// Loop, decision, parallel branches and a for-each block.
const tools = {
  list: tool({ output: z.object({ numbers: z.array(z.number()) }), run: () => ({ numbers: [1, 2, 3] }) }),
  square: tool({ input: z.object({ n: z.number() }), output: z.object({ sq: z.number() }), run: ({ n }) => ({ sq: n * n }) }),
  sum: tool({ input: z.object({ each: z.array(z.object({ sq: z.number() })) }), output: z.object({ total: z.number() }), run: ({ each }) => ({ total: each.reduce((a, e) => a + e.sq, 0) }) }),
  left: tool({ output: z.object({ l: z.number() }), run: async () => ({ l: 1 }) }),
  right: tool({ output: z.object({ r: z.number() }), run: async () => ({ r: 2 }) }),
  bump: tool({ input: z.object({ count: z.number().optional() }), output: z.object({ count: z.number() }), run: ({ count = 0 }) => ({ count: count + 1 }) }),
  ask: human({ resume: z.object({ ok: z.boolean() }) }),
  write: tool({ output: z.object({ line: z.string() }), run: async (_i, ctx) => ({ line: await ai.text(ctx, { prompt: 'hello' }) }) }),
};
const ai = defineAI({ model: 'fake' });
const source = `flowchart TD
  list --> each
  subgraph each["for n in numbers"]
    square
  end
  each --> sum
  sum --> left
  sum --> right
  left --> bump
  right --> bump
  bump --> enough{"count >= 3"}
  enough -->|no, max 5| bump
  enough -->|yes| write --> ask --> done([Done])
  class each foreach`;

assert(compile(source).hash.length === 64, 'compile');
const store = memoryStore();
const options = { store, runAgent: async () => 'from the model' };
const paused = await run(source, tools, {}, options);
assert(paused.status === 'paused' && paused.waitingAt[0].node === 'ask', 'pauses at the human step');
const done = await resume(paused.runId, tools, { ok: true }, options);
assert(done.status === 'completed', 'completes after resume');
assert(done.output.total === 14 && done.output.count === 3 && done.output.l === 1 && done.output.r === 2 && done.output.line === 'from the model', 'results');

// Timeouts and cancellation rely on AbortSignal.
const slow = await run('flowchart TD\n  s', { s: tool({ timeoutMs: 20, run: () => new Promise(() => {}) }) });
assert(slow.status === 'failed' && slow.error.code === 'E1324', 'timeout');

// File loading, the SQLite store and the viewer need a server runtime. They live in a second
// file that is only loaded there, so this file stays loadable in a browser or edge worker.
let extras = [];
if (typeof process !== 'undefined' && !globalThis.EDGE) {
  const serverPart = './runtime-check-server.mjs';
  extras = await (await import(serverPart)).default(assert);
}
console.log(`ok  ${runtime}  core${extras.length ? ', ' + extras.join(', ') : ''}`);
