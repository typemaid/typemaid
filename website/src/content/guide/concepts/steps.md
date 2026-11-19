Every box in a diagram runs a step. There are three kinds, made with three helpers from `typemaid`.

| Kind | Helper | What it does |
|---|---|---|
| Tool | `tool()` | Runs your code. |
| Agent | `agent()` or `ai.agent()` | Asks a model for structured output. |
| Human | `human()` | Pauses the run until a person answers. |

## Tools

A tool declares the fields it reads (`input`), the fields it adds (`output`) and a `run` function. Both schemas are Zod objects.

```ts
import { z } from 'zod';
import { tool } from 'typemaid';

export const charge = tool({
  input: z.object({ amount: z.number() }),
  output: z.object({ receipt: z.string() }),
  retries: 2,          // extra tries after the first one fails
  timeoutMs: 10_000,   // give up on one try after 10 seconds
  run: ({ amount }, ctx) => payments.charge(amount, { idempotencyKey: ctx.key, signal: ctx.signal }),
});
```

`run` may be async. Its second argument, `ctx`, carries:

| Field | What it is |
|---|---|
| `ctx.key` | The same value every time this step is retried or re-run after a crash. Pass it to APIs that support idempotency keys. |
| `ctx.attempt` | `1` for the first try. |
| `ctx.signal` | Aborted when the step times out or the run is cancelled. |
| `ctx.auth` | Whatever you passed as `auth` to `run()`. Never stored with the run. |
| `ctx.runId`, `ctx.nodeId` | Which run and which box this is. |
| `ctx.ask()`, `ctx.text()` | Call a model from inside the tool. See [Models](/docs/models/). |

## Agents

An agent step sends a prompt to a model and checks the answer against `output`. `{field}` in the prompt is filled in from the run's fields.

```ts
import { z } from 'zod';
import { agent } from 'typemaid';

export const summarize = agent({
  instructions: 'You write short, factual summaries.',
  prompt: 'Summarize this text as at least three short bullet points:\n\n{text}',
  output: z.object({ bullets: z.array(z.string()) }),
});
```

If an answer does not fit `output`, the model is asked once more and told what was wrong; after that the step fails. The model comes from `agent({ model })`, from [`defineAI()`](/docs/api/ai/), or from the `model` option of `run()`.

## Human steps

A human step pauses the run and tells you what it is waiting for. `resume` is the schema of the answer.

```ts
import { z } from 'zod';
import { human } from 'typemaid';

export const approve = human({
  resume: z.object({ note: z.string().optional() }),
});
```

When the box has arrows labelled `approved` and `rejected`, the answer must also include `decision` with one of those labels. See [Pausing and resuming](/docs/guides/pausing/).

## Options for every step

| Option | Kinds | Default | Meaning |
|---|---|---|---|
| `description` | all | | A short note on what the step does, shown in the viewer. |
| `retries` | tool, agent | `0` | Extra tries after the first one fails. |
| `timeoutMs` | tool, agent | 5 minutes | Time limit for one try. |

Full signatures are in the [API reference](/docs/api/steps/).
