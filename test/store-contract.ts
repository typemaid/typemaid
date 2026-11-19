import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { human, resume, run, StaleRunError, tool, type RunRecord, type Store } from 'typemaid';

/** A store that stops saving after `allowed` saves, like a process that died. */
export function dyingStore(inner: Store, allowed: number): Store {
  let saves = 0;
  return {
    create: (r) => inner.create(r),
    load: (t, id) => inner.load(t, id),
    save: async (r, v) => {
      if (++saves > allowed) throw new Error('process died');
      return inner.save(r, v);
    },
  };
}

function countingTools() {
  const calls: Record<string, string[]> = {};
  const step = (name: string, field: string) =>
    tool({
      output: z.object({ [field]: z.number() }),
      run: (_input, ctx) => {
        (calls[name] ??= []).push(ctx.key);
        return { [field]: (calls[name]!.length > 0 ? 1 : 0) };
      },
    });
  return {
    calls,
    tools: {
      a: step('a', 'fa'),
      b: step('b', 'fb'),
      c: step('c', 'fc'),
      d: step('d', 'fd'),
      e: tool({ input: z.object({ fa: z.number(), fb: z.number(), fc: z.number(), fd: z.number() }), output: z.object({ sum: z.number() }), run: (i, ctx) => { (calls.e ??= []).push(ctx.key); return { sum: i.fa + i.fb + i.fc + i.fd }; } }),
    },
  };
}

const SRC = 'flowchart TD\n  a --> b\n  a --> c\n  b --> d\n  c --> d\n  d --> e';

export interface StoreContractOptions {
  /** Two separate connections to the same saved runs. Adds the tests that need a second worker. */
  pair?: () => Store[] | Promise<Store[]>;
  /** Skip every test, for stores that need a server that is not there. */
  skip?: boolean;
}

/**
 * The tests every store must pass. `make` returns a store with no runs in it;
 * it is called many times, and stores from different calls must not see each other's runs.
 */
export function storeContract(name: string, make: () => Store | Promise<Store>, options: StoreContractOptions = {}): void {
  describe.skipIf(options.skip === true)(name, () => {
    it('saves and loads a run exactly', async () => {
      const store = await make();
      const t = { ask: human({ resume: z.object({ ok: z.boolean() }) }) };
      const input = { note: 'héllo ✓ 🙂', quote: `it's "quoted" \\ back`, zero: 'a\u0000b', nested: { list: [1, 'two', null], big: 2 ** 53 - 1, small: 0.1 } };
      const paused = await run('flowchart TD\n  ask', t, input, { store, tenant: 'acme' });
      const record = (await store.load('acme', paused.runId))!;
      expect(record).toMatchObject({ format: 1, tenant: 'acme', runId: paused.runId, status: 'paused', state: { ctx: input } });
      expect(record.flow.nodes.ask).toBeDefined();
      expect(typeof record.version).toBe('number');
      expect(record.createdAt).toBe(new Date(record.createdAt).toISOString());
      expect(record.updatedAt).toBe(new Date(record.updatedAt).toISOString());
      expect(await store.load('other', paused.runId)).toBeUndefined();
      expect(await store.load('acme', 'no-such-run')).toBeUndefined();
    });

    it('refuses a save from a worker that is behind', async () => {
      const store = await make();
      const t = { ask: human() };
      const paused = await run('flowchart TD\n  ask', t, {}, { store });
      const record = (await store.load('default', paused.runId)) as RunRecord;
      await store.save({ ...record, version: record.version + 1 }, record.version);
      await expect(store.save({ ...record, version: record.version + 1 }, record.version)).rejects.toBeInstanceOf(StaleRunError);
      expect((await store.load('default', paused.runId))!.version).toBe(record.version + 1);
    });

    it('refuses a save for a run that was never created', async () => {
      const store = await make();
      const paused = await run('flowchart TD\n  ask', { ask: human() }, {}, { store });
      const record = (await store.load('default', paused.runId)) as RunRecord;
      await expect(store.save({ ...record, runId: 'ghost' }, record.version)).rejects.toBeInstanceOf(StaleRunError);
      await expect(store.save({ ...record, tenant: 'other' }, record.version)).rejects.toBeInstanceOf(StaleRunError);
    });

    it('refuses two runs with the same id, but allows the same id for another tenant', async () => {
      const store = await make();
      const t = { ask: human() };
      await run('flowchart TD\n  ask', t, {}, { store, runId: 'same' });
      await expect(run('flowchart TD\n  ask', t, {}, { store, runId: 'same' })).rejects.toThrow(/already exists/);
      expect(await run('flowchart TD\n  ask', t, {}, { store, runId: 'same', tenant: 'other' })).toMatchObject({ status: 'paused' });
    });

    it('wherever the process dies, resuming finishes the run with the right result', async () => {
      const reference = countingTools();
      const clean = await run(SRC, reference.tools, {}, { store: await make() });
      expect(clean).toMatchObject({ status: 'completed', output: { sum: 4 } });

      let finishedWithoutDying = false;
      for (let allowed = 0; allowed < 40 && !finishedWithoutDying; allowed++) {
        const store = await make();
        const { tools, calls } = countingTools();
        const runId = `crash-${allowed}`;
        try {
          await run(SRC, tools, {}, { store: dyingStore(store, allowed), runId });
          finishedWithoutDying = true;
        } catch (err) {
          expect((err as Error).message).toBe('process died');
        }
        const result = await resume(runId, tools, {}, { store });
        expect(result, `died after ${allowed} saves`).toMatchObject({ status: 'completed', output: { sum: 4 } });
        for (const [step, keys] of Object.entries(calls)) {
          // At least once, at most twice (once before the crash, once after), always with the same key.
          expect(keys.length, `${step} after ${allowed} saves`).toBeGreaterThanOrEqual(1);
          expect(keys.length, `${step} after ${allowed} saves`).toBeLessThanOrEqual(2);
          expect(new Set(keys).size).toBe(1);
        }
      }
      expect(finishedWithoutDying).toBe(true);
    });

    it('a crash inside a loop resumes with the loop counter intact', async () => {
      const src = 'flowchart TD\n  bump --> enough{"n >= 4"}\n  enough -->|no, max 3| bump\n  enough -->|yes| finish([Done])';
      const tools = () => ({ bump: tool({ input: z.object({ n: z.number().optional() }), output: z.object({ n: z.number() }), run: ({ n = 0 }) => ({ n: n + 1 }) }) });
      for (let allowed = 0; allowed < 12; allowed++) {
        const store = await make();
        const runId = `loop-${allowed}`;
        await run(src, tools(), {}, { store: dyingStore(store, allowed), runId }).catch(() => undefined);
        const result = await resume(runId, tools(), {}, { store });
        expect(result, `died after ${allowed} saves`).toMatchObject({ status: 'completed', output: { n: 4 } });
      }
    });

    it('a step that fails can be retried later from the saved run', async () => {
      const store = await make();
      let broken = true;
      const t = { flaky: tool({ output: z.object({ ok: z.boolean() }), run: () => { if (broken) throw new Error('boom'); return { ok: true }; } }) };
      const failed = await run('flowchart TD\n  flaky', t, {}, { store });
      expect(failed).toMatchObject({ status: 'failed' });
      expect((await store.load('default', failed.runId))!.status).toBe('failed');
      broken = false;
      expect(await resume(failed.runId, t, {}, { store })).toMatchObject({ status: 'completed', output: { ok: true } });
    });

    const pair = options.pair;
    it.skipIf(!pair)('a run paused through one connection is finished through another', async () => {
      const [a, b] = (await pair!()) as [Store, Store];
      const t = { ask: human({ resume: z.object({ ok: z.boolean() }) }), after: tool({ input: z.object({ ok: z.boolean() }), output: z.object({ done: z.boolean() }), run: ({ ok }) => ({ done: ok }) }) };
      const paused = await run('flowchart TD\n  ask --> after', t, {}, { store: a });
      expect(await resume(paused.runId, t, { ok: true }, { store: b })).toMatchObject({ status: 'completed', output: { done: true } });
      expect((await a.load('default', paused.runId))!.status).toBe('completed');
    });

    it.skipIf(!pair)('two connections cannot both move the same run on', async () => {
      const [a, b] = (await pair!()) as [Store, Store];
      const slow = tool({ run: () => new Promise<void>((r) => setTimeout(r, 30)) });
      const t = { ask: human(), slow };
      const paused = await run('flowchart TD\n  ask --> slow', t, {}, { store: a });
      const results = await Promise.allSettled([resume(paused.runId, t, {}, { store: a }), resume(paused.runId, t, {}, { store: b })]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(StaleRunError);
    });

    it.skipIf(!pair)('of many saves racing for the same version, exactly one wins', async () => {
      const stores = await pair!();
      const first = stores[0]!;
      const paused = await run('flowchart TD\n  ask', { ask: human() }, {}, { store: first });
      const record = (await first.load('default', paused.runId)) as RunRecord;
      const racers = Array.from({ length: 12 }, (_, i) => stores[i % stores.length]!);
      const results = await Promise.allSettled(racers.map((s) => s.save({ ...record, version: record.version + 1 }, record.version)));
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(StaleRunError);
    });
  });
}
