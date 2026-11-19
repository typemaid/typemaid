A support workflow that reads a ticket, scores how urgent it is, and asks a manager before answering urgent ones. It shows decisions, a human step with `approved`/`rejected` arrows, and pausing and resuming.

## The diagram

```mermaid file=examples/triage/triage.mmd
```

- `urgent` is a decision on the `priority` field.
- `approve` is a human step (the `{{ }}` shape and `:::human` hint). Its two arrows are chosen by the manager's `decision`.
- Low-priority tickets go straight to `reply` and never pause.

## The steps

```ts file=examples/triage/tools.ts
```

`reply` reads `note` as optional: it is only there when a manager answered. `send` uses `ctx.key`, which stays the same if the step is re-run, so a real mail API can drop duplicates.

## Run it

```ts
import { memoryStore, resume, run } from 'typemaid';
import * as tools from './tools.ts';

const store = memoryStore(); // use sqliteStore('./runs.db') to survive restarts

const paused = await run('./triage.mmd', tools, { ticketId: 'T-URGENT' }, { store });
// {
//   status: 'paused',
//   waitingAt: [{ node: 'approve', label: 'Manager approval',
//                 fields: { note: { kind: 'string', required: false } },
//                 options: ['approved', 'rejected'] }]
// }

const done = await resume(paused.runId, tools, { decision: 'approved', note: 'on it' }, { store });
// {
//   status: 'completed',
//   output: { ticketId: 'T-URGENT', body: 'Production is down, please help!', priority: 5,
//             note: 'on it', decision: 'approved',
//             draft: 'Re: Production is down, please help! (on it)', sent: true }
// }
```

With `{ decision: 'rejected' }` the run takes the other arrow and ends with `closed: true` instead. A ticket like `T-1` has priority 2, so it completes without pausing.

## What to try

- Replace `classify` with an [agent step](/docs/concepts/steps/#agents) that asks a model for the priority.
- Keep runs in SQLite and resume from a separate script: see [Pausing and resuming](/docs/guides/pausing/).
