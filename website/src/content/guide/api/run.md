Start a run and continue until it completes, pauses for a person, or fails.

```ts
import { run } from 'typemaid';

function run(
  flow: string | URL | CompiledFlow,
  tools: Tools,
  input?: Record<string, unknown>,
  options?: RunOptions,
): Promise<RunResult>;
```

## Parameters

| Parameter | Type | Description |
|---|---|---|
| `flow` | `string \| URL \| CompiledFlow` | A path or URL to a `.mmd`/`.mermaid` file, the Mermaid text itself, or a flow from [`compile()`](/docs/api/compile/). A string is read as a file when it ends in `.mmd` or `.mermaid` or starts with `file:`. |
| `tools` | `Tools` | An object whose keys are the node names: usually `import * as tools from './tools.ts'`. |
| `input` | `Record<string, unknown>` | The starting fields. Defaults to `{}`. |
| `options` | `RunOptions` | See below. |

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `store` | `Store` | shared in-memory store | Where the run is saved. Needed to resume after the process exits. See [Stores](/docs/api/stores/). |
| `start` | `string` | first entry point | Which `:::start` node to begin at. |
| `runId` | `string` | random UUID | Your own ID for the run. |
| `tenant` | `string` | `'default'` | Keeps runs of different customers apart in one store. |
| `auth` | `unknown` | | Credentials for your tools, read as `ctx.auth`. Never stored with the run. |
| `model` | AI SDK model | | Default model for agent steps and `ctx.ask`/`ctx.text`. |
| `runAgent` | `AgentRunner` | | Replaces model calls, for example with a fake in tests. |
| `onEvent` | `(event: RunEvent) => void` | | Called as the run moves. See [events](/docs/concepts/runs/#watching-a-run). |
| `signal` | `AbortSignal` | | Cancels the run. Steps see it as `ctx.signal`. |
| `limits` | `Limits` | | `maxSteps`, `timeoutMs`, `concurrency`, `maxContextChars`. See [limits](/docs/concepts/runs/#limits). |
| `sleep` | `(ms: number) => Promise<void>` | real timer | The wait between retries. Replace in tests. |

## Returns

A `RunResult`:

```ts
type RunResult =
  | { status: 'completed'; runId: string; output: Record<string, unknown> }
  | { status: 'paused'; runId: string; waitingAt: Waiting[] }
  | { status: 'failed'; runId: string; error: RunFailure };
```

A failed run is returned, not thrown. See [Runs and results](/docs/concepts/runs/).

## Throws

`FlowError` when the run cannot start: a mistake in the diagram, a box with no matching export, a missing required input, an input that is not an object, or a `start` that is not an entry point. Nothing has run when it throws.

## Example

```ts
import { run } from 'typemaid';
import { sqliteStore } from 'typemaid/sqlite';
import * as tools from './flows/tools.ts';

const result = await run('./flows/triage.mmd', tools, { ticketId: 'T-1' }, {
  store: sqliteStore('./runs.db'),
  auth: { apiKey: process.env.HELPDESK_KEY },
  limits: { timeoutMs: 30_000 },
});

if (result.status === 'completed') console.log(result.output);
if (result.status === 'paused') console.log('waiting at', result.waitingAt.map((w) => w.node));
if (result.status === 'failed') console.error(result.error.code, result.error.message, result.error.node);
```
