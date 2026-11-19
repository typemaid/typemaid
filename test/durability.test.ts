import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { human, memoryStore, resume, run, tool } from 'typemaid';
import { sqliteStore } from 'typemaid/sqlite';
import { storeContract } from './store-contract.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'flow-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const dbFile = () => path.join(dir, `runs-${++n}.db`);

storeContract('memory store', () => memoryStore());
storeContract('sqlite store', () => sqliteStore(dbFile()), {
  pair: () => {
    const file = dbFile();
    return [sqliteStore(file), sqliteStore(file)];
  },
});

describe('sqlite store', () => {
  it('a paused run survives closing and reopening the database', async () => {
    const file = dbFile();
    const t = { ask: human({ resume: z.object({ ok: z.boolean() }) }), after: tool({ input: z.object({ ok: z.boolean() }), output: z.object({ done: z.boolean() }), run: ({ ok }) => ({ done: ok }) }) };
    const first = sqliteStore(file);
    const paused = await run('flowchart TD\n  ask --> after', t, {}, { store: first });
    first.close();
    const second = sqliteStore(file);
    expect(await resume(paused.runId, t, { ok: true }, { store: second })).toMatchObject({ status: 'completed', output: { done: true } });
    second.close();
  });

  it('two connections cannot both move the same run on', async () => {
    const file = dbFile();
    const a = sqliteStore(file);
    const b = sqliteStore(file);
    const slow = tool({ run: () => new Promise<void>((r) => setTimeout(r, 30)) });
    const t = { ask: human(), slow };
    const paused = await run('flowchart TD\n  ask --> slow', t, {}, { store: a });
    const results = await Promise.allSettled([resume(paused.runId, t, {}, { store: a }), resume(paused.runId, t, {}, { store: b })]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    a.close();
    b.close();
  });
});
