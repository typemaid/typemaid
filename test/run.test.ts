import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { compile, FlowError, human, memoryStore, resume, run, runDiagram, StaleRunError, tool, type RunEvent } from 'typemaid';
import { accept } from './files.ts';
import * as tools from './tools.ts';

const fixture = (name: string) => accept.find((f) => f.name === name)!.source;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const noSleep = async () => {};

describe('sequence, branches and choices', () => {
  it('passes fields from step to step by name', async () => {
    const result = await run(fixture('sequence'), tools, { a: 2, b: 3 });
    expect(result).toMatchObject({ status: 'completed', output: { a: 2, b: 3, sum: 10 } });
  });

  it('a decision follows yes or no', async () => {
    expect(await run(fixture('branch'), tools, { a: 10, b: 5 })).toMatchObject({ output: { sum: 30 } });
    expect(await run(fixture('branch'), tools, { a: 1, b: 2 })).toMatchObject({ output: { sum: -3 } });
  });

  it('labelled arrows follow the step\'s `decision` output', async () => {
    const src = `flowchart TD\n  add --> route\n${fixture('choice').split('\n').slice(1).join('\n')}`;
    expect(await run(src, tools, { a: 1, b: 2 })).toMatchObject({ output: { decision: 'small', sum: 6 } });
    expect(await run(src, tools, { a: 10, b: 2 })).toMatchObject({ output: { decision: 'large', sum: -12 } });
  });

  it('a decision that names no arrow fails the run with the options listed', async () => {
    const bad = { pick: tool({ output: z.object({ decision: z.string() }), run: () => ({ decision: 'sideways' }) }), a: tools.add, b: tools.add };
    const result = await run('flowchart TD\n  pick -->|up| a\n  pick -->|down| b', bad, { a: 1, b: 1 });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1311', node: 'pick' } });
    expect(result.status === 'failed' && result.error.message).toContain('up, down');
  });

  it('a decision on a value that is not true/false fails clearly', async () => {
    const t = { ...tools, isBig: () => 'yes' as unknown as boolean };
    const result = await run('flowchart TD\n  add --> d{isBig}\n  d -->|yes| double\n  d -->|no| negate', t, { a: 1, b: 1 });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1312', node: 'd' } });
  });

  it('the same tool can be used at two nodes', async () => {
    expect(await run(fixture('reuse'), tools, { a: 1, b: 1 })).toMatchObject({ output: { sum: 8 } });
  });
});

describe('inputs', () => {
  it('refuses to start when a needed input is missing, before any tool runs', async () => {
    let ran = false;
    const t = { add: tool({ input: z.object({ a: z.number(), b: z.number() }), run: () => void (ran = true) }) };
    await expect(run('flowchart TD\n  add', t, { a: 1 })).rejects.toThrow(/missing input: b/);
    await expect(run('flowchart TD\n  add', t, { a: 1 })).rejects.toBeInstanceOf(FlowError);
    expect(ran).toBe(false);
  });

  it('fails the step when an input has the wrong type', async () => {
    const result = await run(fixture('sequence'), tools, { a: 'two', b: 3 });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1320', node: 'add' } });
  });

  it('refuses an unknown start node', async () => {
    await expect(run(fixture('sequence'), tools, { a: 1, b: 1 }, { start: 'double' })).rejects.toThrow(/not a start node/);
  });

  it('a tool with no input schema sees a copy of everything and cannot change it', async () => {
    const t = {
      peek: tool({ output: z.object({ seen: z.array(z.string()) }), run: (ctx: unknown) => {
        const c = ctx as Record<string, unknown>;
        const seen = Object.keys(c).sort();
        c.a = 'changed';
        return { seen };
      } }),
    };
    expect(await run('flowchart TD\n  peek', t, { a: 1, z: 2 })).toMatchObject({ output: { a: 1, seen: ['a', 'z'] } });
  });

  it('only JSON values travel between steps', async () => {
    const t = { now: tool({ run: () => ({ at: new Date(0), gone: undefined, n: 1 }) as never, output: z.any() }) };
    const result = await run('flowchart TD\n  now', t);
    expect(result).toMatchObject({ status: 'completed', output: { at: '1970-01-01T00:00:00.000Z', n: 1 } });
    expect(result.status === 'completed' && 'gone' in result.output).toBe(false);
  });

  it('a step may not write a field named __proto__', async () => {
    const t = { evil: tool({ output: z.any(), run: () => JSON.parse('{"__proto__": {"polluted": true}}') }) };
    const result = await run('flowchart TD\n  evil', t);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1325' } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('loops', () => {
  const loop = 'flowchart TD\n  bump --> enough{"n >= target"}\n  enough -->|no, max 3| bump\n  enough -->|yes| finish([Done])';
  const bump = tool({ input: z.object({ n: z.number().optional() }), output: z.object({ n: z.number() }), run: ({ n = 0 }) => ({ n: n + 1 }) });

  it('repeats until the condition holds', async () => {
    expect(await run(loop, { bump }, { target: 3 })).toMatchObject({ status: 'completed', output: { n: 3 } });
  });

  it('stops with a named error when the limit is reached', async () => {
    const result = await run(loop, { bump }, { target: 99 });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1313', node: 'enough' } });
    expect(result.status === 'failed' && result.error.message).toContain('limit of 3');
  });

  it('each pass gets its own idempotency key', async () => {
    const keys: string[] = [];
    const t = { bump: tool({ input: z.object({ n: z.number().optional() }), output: z.object({ n: z.number() }), run: ({ n = 0 }, ctx) => (keys.push(ctx.key), { n: n + 1 }) }) };
    await run(loop, t, { target: 3 }, { runId: 'r1', store: memoryStore() });
    expect(keys).toEqual(['r1:bump:0', 'r1:bump:1', 'r1:bump:2']);
  });

  it('nested loops: the inner limit starts again for each pass of the outer loop', async () => {
    // Three tasks; every task fails its check twice before passing. The inner limit is 3 per task.
    const attempts = new Map<string, number>();
    const runAgent = async ({ node, prompt }: { node: string; prompt: string }) => {
      if (node === 'plan') return { tasks: ['t1', 't2', 't3'] };
      if (node === 'task') {
        const list = JSON.parse(prompt.slice(prompt.indexOf('['))) as string[];
        const current = list[0]!;
        const tries = (attempts.get(current) ?? 0) + 1;
        attempts.set(current, tries);
        return tries < 3 ? { tasks: list, result: `${current}:bad` } : { tasks: list.slice(1), result: `${current}:good` };
      }
      return { passes: prompt.endsWith(':good') };
    };
    const store = memoryStore();
    const paused = await run(fixture('nested-loops'), tools, { goal: 'ship it' }, { store, runAgent });
    expect(paused).toMatchObject({ status: 'paused', waitingAt: [{ node: 'approve', options: ['rejected', 'approved'] }] });
    expect([...attempts.values()]).toEqual([3, 3, 3]);

    // Rejecting sends the run back to planning; everything runs again.
    attempts.clear();
    const again = await resume(paused.runId, tools, { decision: 'rejected', comment: 'redo' }, { store, runAgent });
    expect(again.status).toBe('paused');
    expect([...attempts.values()]).toEqual([3, 3, 3]);
    const done = await resume(paused.runId, tools, { decision: 'approved' }, { store, runAgent });
    expect(done).toMatchObject({ status: 'completed', output: { decision: 'approved', tasks: [], passes: true } });
  });

  it('maxSteps stops a run that does too much', async () => {
    const result = await run(loop, { bump }, { target: 3 }, { limits: { maxSteps: 4 } });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1310' } });
  });
});

describe('parallel branches', () => {
  it('runs branches at the same time and joins once', async () => {
    const log: string[] = [];
    const slow = (name: string, field: string) =>
      tool({ output: z.object({ [field]: z.number() }), run: async () => { log.push(`${name}:start`); await wait(30); log.push(`${name}:end`); return { [field]: 1 }; } });
    const t = { ...tools, left: slow('left', 'l'), right: slow('right', 'r'), merge: tool({ input: z.object({ l: z.number(), r: z.number() }), output: z.object({ merged: z.number() }), run: ({ l, r }) => (log.push('merge'), { merged: l + r }) }) };
    const result = await run(fixture('parallel'), t, { a: 1, b: 1 });
    expect(result).toMatchObject({ status: 'completed', output: { merged: 2 } });
    expect(log.slice(0, 2).sort()).toEqual(['left:start', 'right:start']);
    expect(log.filter((l) => l === 'merge')).toHaveLength(1);
  });

  it('branches that never meet all run to the end', async () => {
    expect(await run(fixture('parallel-end'), tools, { a: 1, b: 2 })).toMatchObject({ status: 'completed', output: { l: 4, r: 5 } });
  });

  it('nested parallel blocks join correctly', async () => {
    const mk = (field: string) => tool({ output: z.object({ [field]: z.number() }), run: () => ({ [field]: 1 }) });
    const order: string[] = [];
    const t = { s: mk('s'), a: mk('a'), b: mk('b'), a1: mk('a1'), a2: mk('a2'), aj: tool({ run: () => void order.push('aj') }), j: tool({ run: () => void order.push('j') }) };
    const src = 'flowchart TD\n  s --> a\n  s --> b\n  a --> a1\n  a --> a2\n  a1 --> aj\n  a2 --> aj\n  aj --> j\n  b --> j';
    const result = await run(src, t);
    expect(result).toMatchObject({ status: 'completed', output: { s: 1, a: 1, b: 1, a1: 1, a2: 1 } });
    expect(order).toEqual(['aj', 'j']);
  });

  it('when one branch fails, the run fails and reports that branch', async () => {
    const t = { ...tools, left: tool({ output: z.object({ l: z.number() }), run: (): { l: number } => { throw new Error('boom'); } }) };
    const result = await run(fixture('parallel'), t, { a: 1, b: 1 });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1321', node: 'left', message: '`left` failed: boom' } });
  });

  it('two people can be asked in parallel and answered in any order', async () => {
    const t = { s: tool({ run: () => undefined }), legal: human({ resume: z.object({ legalOk: z.boolean() }) }), finance: human({ resume: z.object({ financeOk: z.boolean() }) }), done: tool({ input: z.object({ legalOk: z.boolean(), financeOk: z.boolean() }), output: z.object({ both: z.boolean() }), run: (i) => ({ both: i.legalOk && i.financeOk }) }) };
    const src = 'flowchart TD\n  s --> legal\n  s --> finance\n  legal --> done\n  finance --> done';
    const store = memoryStore();
    const paused = await run(src, t, {}, { store });
    expect(paused.status === 'paused' && paused.waitingAt.map((w) => w.node)).toEqual(['legal', 'finance']);
    await expect(resume(paused.runId, t, { legalOk: true }, { store })).rejects.toThrow(/waiting at several steps \(legal, finance\)/);
    const half = await resume(paused.runId, t, { financeOk: true }, { store, node: 'finance' });
    expect(half.status === 'paused' && half.waitingAt.map((w) => w.node)).toEqual(['legal']);
    expect(await resume(paused.runId, t, { legalOk: true }, { store })).toMatchObject({ status: 'completed', output: { both: true } });
  });
});

describe('for-each', () => {
  const src = 'flowchart TD\n  listNumbers --> each\n  subgraph each["for n in numbers"]\n    work\n  end\n  each --> finish([Done])\n  class each foreach';

  it('keeps input order even when items finish out of order, and limits how many run at once', async () => {
    let active = 0;
    let peak = 0;
    const work = tool({ input: z.object({ n: z.number() }), output: z.object({ out: z.number() }), run: async ({ n }) => { peak = Math.max(peak, ++active); await wait((5 - n) * 8); active--; return { out: n * 10 }; } });
    const result = await run(src, { ...tools, work }, {}, { limits: { concurrency: 2 } });
    expect(result).toMatchObject({ status: 'completed', output: { each: [{ out: 10 }, { out: 20 }, { out: 30 }, { out: 40 }] } });
    expect(peak).toBe(2);
  });

  it('fields written inside an item do not leak out', async () => {
    const work = tool({ input: z.object({ n: z.number() }), output: z.object({ out: z.number() }), run: ({ n }) => ({ out: n }) });
    const result = await run(src, { ...tools, work });
    expect(result.status === 'completed' && Object.keys(result.output).sort()).toEqual(['each', 'numbers']);
  });

  it('items can read fields from outside the block', async () => {
    const work = tool({ input: z.object({ n: z.number(), factor: z.number() }), output: z.object({ out: z.number() }), run: ({ n, factor }) => ({ out: n * factor }) });
    const result = await run(src, { ...tools, work }, { factor: 3 });
    expect(result).toMatchObject({ output: { each: [{ out: 3 }, { out: 6 }, { out: 9 }, { out: 12 }] } });
    await expect(run(src, { ...tools, work })).rejects.toThrow(/missing input: factor/);
  });

  it('an empty list gives an empty result', async () => {
    const t = { listNumbers: tool({ output: z.object({ numbers: z.array(z.number()) }), run: () => ({ numbers: [] }) }), work: tools.square };
    expect(await run(src.replace('for n in', 'for item in'), t)).toMatchObject({ status: 'completed', output: { each: [] } });
  });

  it('a failing item fails the run and names the step', async () => {
    const work = tool({ input: z.object({ n: z.number() }), run: ({ n }) => { if (n === 3) throw new Error('bad item'); } });
    expect(await run(src, { ...tools, work })).toMatchObject({ status: 'failed', error: { code: 'E1321', node: 'work' } });
  });

  it('item keys include the item index', async () => {
    const keys: string[] = [];
    const work = tool({ input: z.object({ n: z.number() }), run: (_i, ctx) => void keys.push(ctx.key) });
    await run(src, { ...tools, work }, {}, { runId: 'r', store: memoryStore(), limits: { concurrency: 1 } });
    expect(keys).toEqual(['r:each.0[0].work:0', 'r:each.0[1].work:0', 'r:each.0[2].work:0', 'r:each.0[3].work:0']);
  });

  it('the list must be a list', async () => {
    const t = { listNumbers: tool({ output: z.object({ numbers: z.any() }), run: () => ({ numbers: 'nope' }) }), work: tool({ run: () => undefined }) };
    expect(await run(src, t)).toMatchObject({ status: 'failed', error: { code: 'E1314', node: 'each' } });
  });
});

describe('retries, timeouts and cancelling', () => {
  it('retries a failing tool with the same key, then succeeds', async () => {
    const seen: Array<{ attempt: number; key: string }> = [];
    const flaky = tool({ retries: 2, output: z.object({ ok: z.boolean() }), run: (_i, ctx) => { seen.push({ attempt: ctx.attempt, key: ctx.key }); if (ctx.attempt < 3) throw new Error('not yet'); return { ok: true }; } });
    const events: RunEvent[] = [];
    const result = await run('flowchart TD\n  flaky', { flaky }, {}, { runId: 'r', store: memoryStore(), sleep: noSleep, onEvent: (e) => events.push(e) });
    expect(result).toMatchObject({ status: 'completed', output: { ok: true } });
    expect(seen).toEqual([{ attempt: 1, key: 'r:flaky:0' }, { attempt: 2, key: 'r:flaky:0' }, { attempt: 3, key: 'r:flaky:0' }]);
    expect(events.filter((e) => e.type === 'node.retry')).toHaveLength(2);
  });

  it('gives up after the allowed retries', async () => {
    let calls = 0;
    const flaky = tool({ retries: 1, run: () => { calls++; throw new Error('always'); } });
    expect(await run('flowchart TD\n  flaky', { flaky }, {}, { sleep: noSleep })).toMatchObject({ status: 'failed', error: { code: 'E1321' } });
    expect(calls).toBe(2);
  });

  it('does not retry output that does not match the schema', async () => {
    let calls = 0;
    const wrong = tool({ retries: 3, output: z.object({ n: z.number() }), run: () => (calls++, { n: 'x' }) as never });
    expect(await run('flowchart TD\n  wrong', { wrong }, {}, { sleep: noSleep })).toMatchObject({ status: 'failed', error: { code: 'E1322' } });
    expect(calls).toBe(1);
  });

  it('times out a slow step and aborts its signal', async () => {
    let aborted = false;
    const slow = tool({ timeoutMs: 20, run: (_i, ctx) => new Promise<void>((resolve) => { ctx.signal.addEventListener('abort', () => { aborted = true; resolve(); }); }) });
    const result = await run('flowchart TD\n  slow', { slow });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1324', node: 'slow' } });
    expect(aborted).toBe(true);
  });

  it('a hung step cannot hang the run', async () => {
    const hung = tool({ run: () => new Promise<void>(() => {}) });
    const result = await run('flowchart TD\n  hung', { hung }, {}, { limits: { timeoutMs: 20 } });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1324' } });
  });

  it('cancelling stops the run', async () => {
    const controller = new AbortController();
    const hung = tool({ run: () => new Promise<void>(() => {}) });
    setTimeout(() => controller.abort(), 20);
    const result = await run('flowchart TD\n  hung', { hung }, {}, { signal: controller.signal });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1330' } });
  });

  it('stops when the carried data grows too large', async () => {
    const big = tool({ output: z.object({ blob: z.string() }), run: () => ({ blob: 'x'.repeat(5000) }) });
    expect(await run('flowchart TD\n  big', { big }, {}, { limits: { maxContextChars: 1000 } })).toMatchObject({ status: 'failed', error: { code: 'E1326' } });
  });
});

describe('pausing, resuming and stored runs', () => {
  const src = 'flowchart TD\n  add --> ask --> double';
  const t = { ...tools, ask: human({ resume: z.object({ ok: z.boolean() }) }) };

  it('pauses at a human step and says what it expects', async () => {
    const result = await run(src, t, { a: 1, b: 2 });
    expect(result).toMatchObject({ status: 'paused', waitingAt: [{ node: 'ask', fields: { ok: { kind: 'boolean', required: true } } }] });
  });

  it('validates the answer and leaves the run paused when it is wrong', async () => {
    const store = memoryStore();
    const paused = await run(src, t, { a: 1, b: 2 }, { store });
    await expect(resume(paused.runId, t, { ok: 'yes' }, { store })).rejects.toThrow(/answer for `ask` is not valid/);
    expect(await resume(paused.runId, t, { ok: true }, { store })).toMatchObject({ status: 'completed', output: { ok: true, sum: 6 } });
  });

  it('resuming a finished run returns its result again without running anything', async () => {
    const store = memoryStore();
    const paused = await run(src, t, { a: 1, b: 2 }, { store });
    const done = await resume(paused.runId, t, { ok: true }, { store });
    expect(await resume(paused.runId, t, { ok: false }, { store })).toEqual(done);
  });

  it('answering twice at the same moment: one wins, the other is told the run moved on', async () => {
    const store = memoryStore();
    const slowDouble = tool({ input: z.object({ sum: z.number() }), output: z.object({ sum: z.number() }), run: async ({ sum }) => { await wait(20); return { sum: sum * 2 }; } });
    const tt = { ...t, double: slowDouble };
    const paused = await run(src, tt, { a: 1, b: 2 }, { store });
    const results = await Promise.allSettled([resume(paused.runId, tt, { ok: true }, { store }), resume(paused.runId, tt, { ok: true }, { store })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(StaleRunError);
  });

  it('a failed run can be retried from the step that failed', async () => {
    const store = memoryStore();
    const calls = { first: 0, second: 0 };
    let broken = true;
    const tt = {
      first: tool({ output: z.object({ x: z.number() }), run: () => (calls.first++, { x: 1 }) }),
      second: tool({ input: z.object({ x: z.number() }), output: z.object({ y: z.number() }), run: ({ x }) => { calls.second++; if (broken) throw new Error('down'); return { y: x + 1 }; } }),
    };
    const failed = await run('flowchart TD\n  first --> second', tt, {}, { store });
    expect(failed.status).toBe('failed');
    broken = false;
    expect(await resume(failed.runId, tt, {}, { store })).toMatchObject({ status: 'completed', output: { x: 1, y: 2 } });
    expect(calls).toEqual({ first: 1, second: 2 });
  });

  it('a run keeps the diagram it started with', async () => {
    const store = memoryStore();
    const paused = await run(src, t, { a: 1, b: 2 }, { store });
    const record = await store.load('default', paused.runId);
    expect(record!.flow.hash).toBe(compile(src).hash);
    expect(record!.format).toBe(1);
  });

  it('auth reaches tools but is never stored', async () => {
    const store = memoryStore();
    let got: unknown;
    const tt = { ...t, add: tool({ input: z.object({ a: z.number(), b: z.number() }), output: z.object({ sum: z.number() }), run: ({ a, b }, ctx) => { got = ctx.auth; return { sum: a + b }; } }) };
    const paused = await run(src, tt, { a: 1, b: 2 }, { store, auth: { token: 'SECRET-123' } });
    expect(got).toEqual({ token: 'SECRET-123' });
    expect(JSON.stringify(await store.load('default', paused.runId))).not.toContain('SECRET-123');
  });

  it('runs of one tenant are invisible to another', async () => {
    const store = memoryStore();
    const paused = await run(src, t, { a: 1, b: 2 }, { store, tenant: 'acme' });
    await expect(resume(paused.runId, t, { ok: true }, { store, tenant: 'other' })).rejects.toThrow(/not found/);
    expect((await resume(paused.runId, t, { ok: true }, { store, tenant: 'acme' })).status).toBe('completed');
  });
});

describe('events and the run diagram', () => {
  it('emits events in order, and a broken listener cannot break the run', async () => {
    const events: string[] = [];
    const result = await run(fixture('branch'), tools, { a: 10, b: 5 }, { onEvent: (e) => { events.push(`${e.type}${'node' in e ? `:${e.node}` : ''}`); throw new Error('listener bug'); } });
    expect(result.status).toBe('completed');
    expect(events).toEqual(['run.start', 'node.start:add', 'node.end:add', 'branch:big', 'node.end:big', 'node.start:double', 'node.end:double', 'node.end:out', 'run.end']);
  });

  it('colours the nodes a run visited, as valid Mermaid', async () => {
    const src = fixture('branch');
    const store = memoryStore();
    const result = await run(src, tools, { a: 10, b: 5 }, { store });
    const record = await store.load('default', result.runId);
    const picture = runDiagram(src, { visits: record!.state.visits });
    expect(picture).toContain('class add,big,double,out runDone');
    expect(() => compile(picture)).not.toThrow();
  });
});
