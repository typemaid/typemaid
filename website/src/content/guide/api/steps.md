The helpers that turn functions and schemas into steps. Export them from your tools file under the node names used in the diagram.

## tool()

```ts
import { tool } from 'typemaid';

function tool(spec: {
  input?: ZodObject;        // fields this tool reads, picked out by name
  output?: ZodObject;       // fields this tool adds
  run: (input, ctx: ToolContext) => output | Promise<output>;
  description?: string;
  retries?: number;         // extra tries after the first failure; default 0
  timeoutMs?: number;       // limit for one try
}): ToolDef;
```

```ts
export const greet = tool({
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  run: ({ name }) => ({ greeting: `Hello, ${name}` }),
});
```

Schemas are read through the [Standard Schema](https://standardschema.dev) interface, including its JSON Schema output, which typemaid uses to know each field's type. Zod 4.2 and newer implement all of it, and these docs use Zod.

## ToolContext

The second argument of `run`.

| Field | Type | Description |
|---|---|---|
| `runId` | `string` | The run. |
| `nodeId` | `string` | The box in the diagram. |
| `key` | `string` | Stable across retries and re-runs after a crash. Use as an idempotency key. |
| `attempt` | `number` | `1` for the first try. |
| `signal` | `AbortSignal` | Aborted when the step times out or the run is cancelled. |
| `auth` | `unknown` | The `auth` option of `run()`. Never stored. |
| `ask(request)` | `Promise<output>` | Ask a model for a structured answer: `{ prompt, output, instructions?, model? }`. |
| `text(request)` | `Promise<string>` | Ask a model for plain text: `{ prompt, instructions?, model? }`. |

## agent()

```ts
import { agent } from 'typemaid';

function agent(spec: {
  prompt: string;           // `{field}` is filled in from the run's fields
  output: ZodObject;        // the answer must match this
  instructions?: string;    // fixed guidance; no placeholders
  model?: unknown;          // AI SDK model; falls back to run({ model })
  tools?: Record<string, AiSdkTool>; // AI SDK tools the model may call
  maxSteps?: number;        // required with tools: most model turns
  description?: string;
  retries?: number;
  timeoutMs?: number;
}): AgentDef;
```

`ai.agent()` from [`defineAI()`](/docs/api/ai/) takes the same spec and fills in the model.

## human()

```ts
import { human } from 'typemaid';

function human(spec?: {
  resume?: ZodObject;       // fields the person must supply
  description?: string;
}): HumanDef;
```

The run pauses at this step. Continue it with [`resume()`](/docs/api/resume/).

## Decision functions

A decision node can name an exported function instead of a condition. It receives the run's fields and returns a boolean:

```ts
// diagram: ok{isBusinessHours}
export const isBusinessHours = (ctx: { now: string }) => new Date(ctx.now).getUTCHours() < 17;
```
