# FAQ

## Is a `.mmd` file just Mermaid?

Yes. It is a Mermaid flowchart and previews in any Mermaid viewer. typemaid accepts a subset: `-->` arrows, labels, decisions, subgraphs for for-each, and a few classes. Anything outside the subset is reported by `check` rather than guessed at. Files can end in `.mmd` or `.mermaid`.

## Can it run any Mermaid diagram?

Flowcharts in the supported subset, yes. Sequence diagrams, state diagrams and the rest are pictures of something else and are not run.

## What happens if the diagram names a step I did not write?

`check` and `run()` stop before anything runs and name the missing export, with a "did you mean" when a similar name exists.

## Does a model decide what runs next?

No. The order comes from the diagram. A model can produce a value that a decision node branches on, but only along arrows you drew.

## Is it durable by default?

No. Runs live in memory unless you pass a `store`. See [Durability](durability.md).

## Does a crashed run restart by itself?

No. Call `resume(runId, tools, {}, { store })`. There is no background worker or queue; typemaid is a library, not a server.

## What happens when a step fails?

The run ends with `status: 'failed'`. `error.code` says why and `error.node` names the step. Errors thrown by your code, time-outs and failed model calls are retried if the step sets `retries`. Schema mismatches and loop caps are not retried. With a store, `resume()` starts again at the failed step. See [Why a run fails](https://typemaid.pages.dev/docs/concepts/runs/#why-a-run-fails).

## Can a step run twice?

Yes, if the process dies between the step finishing and its result being saved. Use `ctx.key` as an idempotency key for anything that must not repeat. See [Durability](durability.md#at-least-once).

## How do I retry a failing step?

`retries: 3` on the step. See [Retries](retries.md).

## Can I use Postgres, Turso, or another database?

Yes. Postgres is `@typemaid/postgres` and libSQL/Turso is `@typemaid/libsql`. For anything else, write a store: three functions, about 40 lines. See [Stores](stores.md).

## Which model providers work?

Any provider the Vercel AI SDK supports. Install its package (`@ai-sdk/openai`, `@ai-sdk/anthropic`, ...) and pass the model to `defineAI`. typemaid has no provider packages of its own. See [Models](models.md).

## Do I have to use the Vercel AI SDK?

No. A tool is ordinary code and can call any SDK or HTTP API. `agent` steps and `ai.ask` use the AI SDK.

## Can a step call an MCP server, an HTTP API, a queue?

Yes. A step is a function; whatever it can import, it can call.

## Does it work with Zod 3?

No. Zod 4.2 or newer.

## Where does it run?

Node 22+ and Bun 1.2+ for everything. In browsers and edge workers the core runs (compile, check, run, resume) when the diagram is passed as text; the SQLite store, the CLI and the viewer need Node or Bun. Deno is untested.

## Can I schedule a workflow?

Not built in. Call `run()` from whatever scheduler you already use (cron, a queue worker, a serverless timer).

## Can two steps run at the same time?

Yes. Several arrows leaving a step run in parallel and meet again where the branches join. A for-each block runs its items in parallel, five at a time by default.

## How do I pass secrets to steps?

Pass `auth` to `run()`. Every step receives it as `ctx.auth`, and it is never saved with the run.

## How do I test a workflow?

Run it with the default memory store. Replace model calls with `runAgent`, and skip retry waits with `sleep: async () => {}`.

## How big is it?

The core is about 160 KB unpacked and needs only Zod. The viewer is a separate package of about 1 MB.

## What is the licence?

FSL-1.1-MIT. You can use it in your own products, including commercial ones. You cannot offer it as a competing product or service. Each release becomes MIT two years after it is published.
