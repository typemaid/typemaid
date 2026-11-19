A human step stops the run and waits for a person. You save the run, show the person what is needed, and continue with their answer, minutes or days later, in the same process or another one.

## 1. Add a human step

```ts
import { z } from 'zod';
import { human } from 'typemaid';

export const approve = human({
  resume: z.object({ note: z.string().optional() }),
});
```

In the diagram, give it `approved` and `rejected` arrows if the person's answer should choose the path:

```mermaid file=examples/triage/triage.mmd
```

## 2. Run with a store

A paused run must be saved somewhere that outlives the request. Pass a store:

```ts
import { run } from 'typemaid';
import { sqliteStore } from 'typemaid/sqlite';
import * as tools from './tools.ts';

const store = sqliteStore('./runs.db');
const result = await run('./triage.mmd', tools, { ticketId: 'T-URGENT' }, { store });

if (result.status === 'paused') {
  // Save result.runId with the ticket, and show the person result.waitingAt.
}
```

`result.waitingAt` says what the run needs:

```json
[{ "node": "approve", "label": "Manager approval", "fields": { "note": { "kind": "string", "required": false } }, "options": ["approved", "rejected"] }]
```

Without a store, runs are kept in memory and lost when the process exits. See [Stores](/docs/stores/) for SQLite, Postgres and libSQL.

## 3. Resume with the answer

```ts
import { resume } from 'typemaid';

const done = await resume(runId, tools, { decision: 'approved', note: 'on it' }, { store });
// { status: 'completed', output: { decision: 'approved', note: 'on it', sent: true, … } }
```

- The answer is checked against the step's `resume` schema.
- When the box has `approved`/`rejected` arrows, `decision` is required and must be one of `options`. Anything else throws: ``The answer for `approve` needs `decision` to be one of: approved, rejected.``
- The answer's fields are merged into the run's fields, so later steps can read `note` and `decision`.

## Several steps waiting

Parallel branches can leave more than one human step waiting. Say which one you are answering with `node`:

```ts
await resume(runId, tools, { decision: 'approved' }, { store, node: 'legalReview' });
```

Without `node`, `resume()` throws and lists the waiting steps.

## The diagram can change meanwhile

A run finishes on the diagram it started with, even if the `.mmd` file changes while it is paused. The compiled flow is saved with the run.

## Retrying failed runs

`resume()` without an answer retries a failed run from the step that failed, and continues a run whose process died. See [`resume()`](/docs/api/resume/).

## From the command line

```bash
typemaid run flows/triage.mmd --input '{"ticketId":"T-URGENT"}' --store runs.db
# Paused. Continue with: typemaid resume <runId> --store runs.db --tools flows/tools.ts --answer '{...}'
typemaid resume <runId> --store runs.db --tools flows/tools.ts --answer '{"decision":"approved"}'
```
