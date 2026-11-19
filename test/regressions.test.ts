/** One test per defect found in review, so none of them can come back unnoticed. */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { bind, check, checkFlow, compile, FlowError, human, memoryStore, resume, run, tool } from 'typemaid';
import { evalExpr, parseExpr } from '../src/core/expr.ts';

const noSleep = async () => {};
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const codes = (source: string, tools: Record<string, unknown>) => checkFlow(source, tools).diagnostics.map((d) => d.code);

describe('compiler', () => {
  it('a `max` on a forward arrow does not turn its target into the start', () => {
    const loop = 'flowchart TD\n  draft --> review\n  review --> good{"score >= 8"}\n  good -->|no, max 5| revise[Revise]\n  revise --> draft\n  good -->|yes| publish';
    expect(compile(loop).entries).toEqual(['draft']);
    expect(compile('flowchart TD\n  a --> ok{passes}\n  ok -->|yes, max 3| b\n  ok -->|no| c').entries).toEqual(['a']);
  });

  it('a long malformed `class` line is rejected quickly', () => {
    const started = performance.now();
    const result = check(`flowchart TD\n  a --> b\n${`class ${' '.repeat(1990)}!\n`.repeat(20)}`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.diagnostics.every((d) => d.code === 'E1002')).toBe(true);
  });

  it('thousands of bad lines are reported quickly, and the message is cut off', () => {
    const source = 'flowchart TD\n' + '  a-->b\n'.repeat(8000);
    const started = performance.now();
    let message = '';
    try {
      compile(source);
    } catch (err) {
      message = (err as FlowError).message;
      expect((err as FlowError).diagnostics.length).toBeGreaterThan(8000);
    }
    expect(performance.now() - started).toBeLessThan(3000);
    expect(message).toMatch(/\.\.\. and \d+ more\.$/);
    expect(message.length).toBeLessThan(20_000);
  });

  it('a very long chain does not overflow the stack when the host raises the limits', () => {
    const source = 'flowchart TD\n' + Array.from({ length: 9000 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n');
    const result = check(source, { limits: { maxNodes: 100_000, maxEdges: 100_000 } });
    expect(result.flow?.entries).toEqual(['n0']);
  });

  it('warns about a class that looks like a misspelt keyword, unless it is a real style', () => {
    expect(check('flowchart TD\n  a:::strat --> b').diagnostics.map((d) => d.code)).toEqual(['W1150']);
    expect(check('flowchart TD\n  classDef strat fill:#eee\n  a:::strat --> b').diagnostics).toEqual([]);
    expect(check('flowchart TD\n  a:::highlight --> b').diagnostics).toEqual([]);
  });
});

describe('conditions', () => {
  it('accept negative numbers and refuse other number formats clearly', () => {
    expect(evalExpr(parseExpr('score > -1'), { score: 0 })).toBe(true);
    expect(evalExpr(parseExpr('-1.5 < score and score == -0.5'), { score: -0.5 })).toBe(true);
    expect(() => parseExpr('score > 1e3')).toThrow(/plain digits/);
    expect(() => parseExpr('a - 1 > 2')).toThrow();
  });
});

describe('data-flow checks', () => {
  const src = 'flowchart TD\n  a --> b';

  it('a step whose output cannot be described may produce anything: no false missing input', async () => {
    const tools = {
      a: tool({ output: z.object({ id: z.string(), at: z.date() }), run: () => ({ id: 'x', at: new Date(0) }) }),
      b: tool({ input: z.object({ id: z.string() }), output: z.object({ seen: z.string() }), run: ({ id }) => ({ seen: id }) }),
    };
    expect(bind(compile(src), tools).inputs.a).toEqual({});
    expect(await run(src, tools)).toMatchObject({ status: 'completed', output: { seen: 'x' } });
  });

  it('an optional output is not treated as always present', () => {
    const tools = {
      a: tool({ output: z.object({ x: z.string().optional() }), run: () => ({}) }),
      b: tool({ input: z.object({ x: z.string() }), run: () => undefined }),
    };
    expect(codes(src, tools)).toEqual(['W1250']);
  });

  it('a field a step both reads and writes must be supplied to start', async () => {
    const tools = { inc: tool({ input: z.object({ count: z.number() }), output: z.object({ count: z.number() }), run: ({ count }) => ({ count: count + 1 }) }) };
    expect(codes('flowchart TD\n  inc', tools)).toEqual([]);
    await expect(run('flowchart TD\n  inc', tools)).rejects.toThrow(/missing input: count \(needed by `inc`\)/);
    expect(await run('flowchart TD\n  inc', tools, { count: 1 })).toMatchObject({ output: { count: 2 } });
  });

  it('no warning where parallel branches meet', () => {
    const mk = (field: string) => tool({ output: z.object({ [field]: z.string() }), run: () => ({ [field]: field }) });
    const tools = { a: tool({ run: () => undefined }), b: mk('x'), c: mk('y'), d: tool({ input: z.object({ x: z.string(), y: z.string() }), run: () => undefined }) };
    expect(codes('flowchart TD\n  a --> b\n  a --> c\n  b --> d\n  c --> d', tools)).toEqual([]);
  });

  it('an input with a default or fallback does not have to be passed', async () => {
    const tools = { a: tool({ input: z.object({ mode: z.string().catch('fast'), n: z.number().default(1) }), output: z.object({ out: z.string() }), run: ({ mode, n }) => ({ out: `${mode}${n}` }) }) };
    expect(bind(compile('flowchart TD\n  a'), tools).inputs.a).toEqual({ mode: { kind: 'string', required: false }, n: { kind: 'number', required: false } });
    expect(await run('flowchart TD\n  a', tools)).toMatchObject({ output: { out: 'fast1' } });
  });

  it('an inherited property does not count as a supplied input', async () => {
    const tools = { a: tool({ input: z.object({ toString: z.string() }), run: () => undefined }) };
    await expect(run('flowchart TD\n  a', tools)).rejects.toThrow(/missing input: toString/);
  });

  it('a misspelt field in a condition gets a "did you mean"', async () => {
    const tools = { draft: tool({ output: z.object({ score: z.number() }), run: () => ({ score: 9 }) }), yes: tool({ run: () => undefined }), no: tool({ run: () => undefined }) };
    const source = 'flowchart TD\n  draft --> ok{"scroe >= 8"}\n  ok -->|yes| yes\n  ok -->|no| no';
    const result = checkFlow(source, tools);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'W1252', line: 2 });
    expect(result.diagnostics[0]!.message).toContain('Did you mean `score`?');
    await expect(run(source, tools)).rejects.toThrow(/missing input: scroe \(needed by `ok`\)/);
  });
});

describe('executor', () => {
  it('the default-style bounded store never drops a run that is still running or paused', async () => {
    const store = memoryStore({ maxRuns: 2 });
    const ask = { ask: human() };
    const paused = await run('flowchart TD\n  ask', ask, {}, { store });
    for (let i = 0; i < 10; i++) await run('flowchart TD\n  a', { a: tool({ run: () => undefined }) }, {}, { store });
    expect((await resume(paused.runId, ask, {}, { store })).status).toBe('completed');
  });

  it('cancelling while waiting to retry stops at once and never calls the tool again', async () => {
    let calls = 0;
    const flaky = tool({ retries: 5, run: () => { calls++; throw new Error('no'); } });
    const controller = new AbortController();
    const started = performance.now();
    const pending = run('flowchart TD\n  flaky', { flaky }, {}, { signal: controller.signal, sleep: () => wait(5000) });
    await wait(30);
    controller.abort();
    expect(await pending).toMatchObject({ status: 'failed', error: { code: 'E1330' } });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(calls).toBe(1);
  });

  it('a person can still answer when another branch of the run has failed', async () => {
    let broken = true;
    const tools = { s: tool({ run: () => undefined }), ask: human({ resume: z.object({ ok: z.boolean() }) }), work: tool({ output: z.object({ done: z.boolean() }), run: () => { if (broken) throw new Error('down'); return { done: true }; } }), finish: tool({ run: () => undefined }) };
    const store = memoryStore();
    const failed = await run('flowchart TD\n  s --> ask\n  s --> work\n  ask --> finish\n  work --> finish', tools, {}, { store });
    expect(failed.status).toBe('failed');
    broken = false;
    expect(await resume(failed.runId, tools, { ok: true }, { store })).toMatchObject({ status: 'completed', output: { ok: true, done: true } });
  });

  it('answering a run that is not waiting is refused', async () => {
    const store = memoryStore();
    const tools = { a: tool({ run: () => { throw new Error('x'); } }) };
    const failed = await run('flowchart TD\n  a', tools, {}, { store });
    await expect(resume(failed.runId, tools, { ok: true }, { store })).rejects.toThrow(/not waiting for an answer/);
  });

  const block = 'flowchart TD\n  list --> each\n  subgraph each["for n in numbers"]\n    one --> two\n  end\n  class each foreach';
  const list = (count: number) => tool({ output: z.object({ numbers: z.array(z.number()) }), run: () => ({ numbers: Array.from({ length: count }, (_, i) => i) }) });

  it('the step limit also counts steps inside a for-each block', async () => {
    let calls = 0;
    const step = tool({ run: () => void calls++ });
    const result = await run(block, { list: list(2000), one: step, two: step }, {}, { limits: { maxSteps: 50 } });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1310' } });
    expect(calls).toBeLessThan(60);
  });

  it('when one for-each item fails, the others stop', async () => {
    const reached: number[] = [];
    const one = tool({ input: z.object({ n: z.number() }), run: async ({ n }) => { if (n === 0) throw new Error('bad'); await wait(40); } });
    const two = tool({ input: z.object({ n: z.number() }), run: ({ n }) => void reached.push(n) });
    const result = await run(block, { list: list(5), one, two }, {}, { limits: { concurrency: 5 } });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1321', node: 'one' } });
    expect(reached).toEqual([]);
  });

  it('a very large or infinite timeout means no time limit, not an instant one', async () => {
    const slow = tool({ timeoutMs: Infinity, output: z.object({ ok: z.boolean() }), run: async () => { await wait(30); return { ok: true }; } });
    expect(await run('flowchart TD\n  slow', { slow })).toMatchObject({ status: 'completed' });
    expect(await run('flowchart TD\n  slow', { slow: tool({ run: () => wait(30) }) }, {}, { limits: { timeoutMs: 2 ** 31 } })).toMatchObject({ status: 'completed' });
  });

  it('a step re-run after a loop-limit failure keeps its idempotency key', async () => {
    const keys: string[] = [];
    const bump = tool({ input: z.object({ n: z.number().optional() }), output: z.object({ n: z.number() }), run: ({ n = 0 }, ctx) => (keys.push(ctx.key), { n: n + 1 }) });
    const store = memoryStore();
    const src = 'flowchart TD\n  bump --> enough{"n >= 99"}\n  enough -->|no, max 2| bump\n  enough -->|yes| finish([Done])';
    const failed = await run(src, { bump }, {}, { store, runId: 'k' });
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'E1313' } });
    expect(keys).toEqual(['k:bump:0', 'k:bump:1', 'k:bump:2']);
    const record = await store.load('default', 'k');
    expect(record!.state.visits).toEqual({ bump: 3, enough: 2 });
  });

  it('the size limit applies to the input and to answers', async () => {
    const tools = { a: tool({ run: () => undefined }), ask: human() };
    expect(await run('flowchart TD\n  a', tools, { blob: 'x'.repeat(5000) }, { limits: { maxContextChars: 100 } })).toMatchObject({ status: 'failed', error: { code: 'E1326' } });
    const store = memoryStore();
    const paused = await run('flowchart TD\n  ask --> a', tools, {}, { store });
    expect(await resume(paused.runId, tools, { blob: 'x'.repeat(5000) }, { store, limits: { maxContextChars: 100 } })).toMatchObject({ status: 'failed', error: { code: 'E1326' } });
  });
});

describe('loading diagrams', () => {
  const tools = { a: tool({ run: () => undefined }) };

  it('one line of text that is not a file name is read as a diagram, not as a path', async () => {
    await expect(run('a --> b', tools)).rejects.toThrow(/must start with `flowchart TD`/);
    await expect(run('/etc/passwd', tools)).rejects.toBeInstanceOf(FlowError);
  });

  it('a missing diagram file gives a plain message', async () => {
    await expect(run('./nope/missing.mmd', tools)).rejects.toThrow('Diagram file not found: ./nope/missing.mmd');
  });
});
