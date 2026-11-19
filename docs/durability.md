# Durability

## Is it durable by default?

No. With no `store`, runs are kept in memory and are gone when the process exits. That is fine for workflows that finish in one go.

Durability is one option:

```ts
import { run, resume } from 'typemaid';
import { sqliteStore } from 'typemaid/sqlite';

const store = sqliteStore('./runs.db');
const result = await run('./flows/triage.mmd', tools, { ticketId: 'T-1' }, { store });
```

You need a store when a workflow has a human step (it pauses, often for hours), or when a run must survive a crash or a deploy.

## What is saved, and when

After every step finishes, the whole run is saved: the shared data, where the run is in the diagram, loop counters, and the diagram itself as it was when the run started.

- **A run finishes on the diagram it started with.** Editing the file does not change runs already in progress.
- **`auth` is never saved.** Pass it again to `resume()`.
- **Values are JSON.** Dates become strings; `undefined` is dropped.

## After a crash

Nothing restarts a run on its own. There is no background worker. Your code calls `resume()` with the run id:

```ts
await resume(runId, tools, {}, { store });
```

The run continues from the last saved point. The same call retries a run that ended as `failed`, starting at the step that failed.

Keep the run ids you care about (for example next to the order or ticket they belong to). The store interface has no "list unfinished runs" call yet.

## At least once

If the process dies after a step did its work but before the result was saved, that step runs again on resume. A step can therefore run more than once; its result is recorded once.

For steps that must not repeat (charge a card, send an email), use `ctx.key`. It is the same value on every retry and every re-run of that step in that run:

```ts
export const charge = tool({
  input: z.object({ amount: z.number() }),
  run: ({ amount }, ctx) => payments.charge({ amount, idempotencyKey: ctx.key }),
});
```

## Pausing for a person

A `human` step saves the run and returns `{ status: 'paused', runId, waitingAt }`. Any process with the same store can answer later:

```ts
await resume(runId, tools, { decision: 'approved' }, { store });
```

## Two workers, one run

Every save says which version of the run it expects to replace. If another worker has already moved the run on, the save fails with `StaleRunError` and that worker must stop. This prevents two processes from both continuing the same run.

## Limits to know

- **A for-each block is saved as a whole.** A crash in the middle re-runs the whole block. Human steps are not allowed inside one.
- **The shared data has a size limit** (5,000,000 characters of JSON by default). Store large files elsewhere and pass a reference.
- **Stores:** memory and SQLite are built in; Postgres and libSQL/Turso are separate packages. See [Stores](stores.md).
