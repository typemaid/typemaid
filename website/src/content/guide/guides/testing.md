Workflows are plain functions, so you test them with your usual test runner. These options make tests fast and repeatable.

## Run the real diagram with fake data

Run the real `.mmd` file and tools file, and assert on the result:

```ts
import { expect, it } from 'vitest';
import { run } from 'typemaid';
import * as tools from './tools.ts';

it('greets loudly', async () => {
  const result = await run(new URL('./hello.mmd', import.meta.url), tools, { name: 'Ada' });
  expect(result).toMatchObject({ status: 'completed', output: { loud: 'HELLO, ADA!' } });
});
```

## Replace the model

Pass `runAgent` to answer agent steps without calling a model. It receives the request (including the filled-in `prompt`) and returns the answer.

```ts
const result = await run('./summarize.mmd', tools, { topic: 'Mermaid' }, {
  runAgent: async (request) => ({ bullets: ['one', 'two', 'three'] }),
});
```

Answers are still checked against the agent's `output` schema. Return an answer that does not fit to test the repair path: the model is asked once more, then the step fails.

## Test pausing and resuming

Use a fresh `memoryStore()` per test so runs do not leak between tests:

```ts
import { memoryStore, resume, run } from 'typemaid';

it('waits for approval, then sends', async () => {
  const store = memoryStore();
  const paused = await run('./triage.mmd', tools, { ticketId: 'T-URGENT' }, { store });
  expect(paused.status).toBe('paused');

  const done = await resume(paused.runId, tools, { decision: 'approved' }, { store });
  expect(done).toMatchObject({ status: 'completed', output: { sent: true } });
});
```

## Skip retry waits

Steps with `retries` wait between tries. Replace the wait in tests:

```ts
await run('./flow.mmd', tools, input, { sleep: async () => {} });
```

## Watch which steps ran

Collect events to assert on the path a run took:

```ts
const steps: string[] = [];
await run('./triage.mmd', tools, { ticketId: 'T-1' }, {
  onEvent: (e) => { if (e.type === 'node.start') steps.push(e.node); },
});
expect(steps).toEqual(['fetchTicket', 'classify', 'reply', 'send']);
```

## Check every diagram in CI

`typemaid check` exits with code 1 on any error, so it works as a CI step:

```bash
npx typemaid check flows
```

See [Checking and errors](/docs/guides/checking/).
