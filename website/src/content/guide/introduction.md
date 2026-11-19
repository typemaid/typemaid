typemaid is a TypeScript SDK for workflows you can see. You draw the flow as a Mermaid flowchart, write one typed function per box, and call `run()`.

```mermaid file=examples/triage/triage.mmd
```

Each box is an export in a tools file. `classify` is your code, `approve` waits for a person, and the arrows decide what runs next.

## Why typemaid

- **The diagram is the program.** Branches, loops, parallel steps and for-each blocks are drawn in Mermaid and compiled to plain JSON. No model decides which step runs next, so a run always follows the drawing.
- **Typed steps.** Every step declares its input and output with Zod. Missing fields, wrong names and impossible loops are reported before anything runs, with the file, the line and a suggested fix.
- **People in the loop.** A human step pauses the run. Save it, and resume it later with the answer, even from another process.
- **Models where you want them.** Agent steps and model calls inside tools go through the Vercel AI SDK, so any provider it supports works. Answers are checked against a schema.
- **Survives restarts.** With a store (SQLite, Postgres or libSQL), a paused or crashed run continues from the last finished step.

## How it works

1. **Draw** the flow in a `.mmd` file. It previews in any Mermaid viewer, including GitHub.
2. **Type** each step in `tools.ts` with `tool()`, `agent()` or `human()`.
3. **Run** it with `run(diagram, tools, input)`. You get back `completed`, `paused` or `failed`.

```ts
import { run } from 'typemaid';
import * as tools from './tools.ts';

const result = await run('./triage.mmd', tools, { ticketId: 'T-1' });
// { status: 'completed', runId: '…', output: { priority: 2, draft: 'Re: …', sent: true, … } }
```

## When to use it

typemaid fits processes with clear steps, decisions and sometimes a person in the loop: support triage, approvals, content review, document extraction, lead scoring, data syncs.

It is not a scheduler or a queue. It does not start runs on a timer, and it does not let a model choose the path. If you want an open-ended agent that decides its own next step, use an agent framework, and call it from a typemaid step if you need both.

## Status

typemaid is v0 and not yet published to npm. The name and the `.mmd` extension can still change.

## Next steps

- [Install it](/docs/installation/), then follow the [Quickstart](/docs/getting-started/).
- Learn the pieces in [Core concepts](/docs/concepts/diagrams/).
- Copy a complete workflow from the [Examples](/docs/examples/support-triage/).
