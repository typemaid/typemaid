## Install

Install typemaid with your package manager:

```bash
npm i typemaid
```

```bash
bun add typemaid
```

npm and Bun also install Zod, which typemaid needs as a peer dependency. pnpm and Yarn do not make it available to your code, so add it yourself:

```bash
pnpm add typemaid zod
```

```bash
yarn add typemaid zod
```

Zod 4.2 or newer is required. Nothing else is installed with typemaid.

## Optional packages

Install these only when you need them.

| Package | When you need it | Install |
|---|---|---|
| `ai` + a provider | Agent steps or model calls inside tools | `npm install ai @ai-sdk/openai` |
| `@typemaid/view` | The workflow viewer (`typemaid view`) | `npm install -D @typemaid/view` |
| `@typemaid/postgres` | Keeping runs in Postgres | `npm install @typemaid/postgres` |
| `@typemaid/libsql` | Keeping runs in libSQL or Turso | `npm install @typemaid/libsql` |

The SQLite store ships with typemaid as `typemaid/sqlite` and uses Node's built-in driver, so it needs no extra package.

Use any [AI SDK provider](https://ai-sdk.dev): `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` and others. typemaid does not re-export them, so you control their versions. See [Models](/docs/models/).

## Runtimes

| Runtime | What works |
|---|---|
| Node 22+ | Everything |
| Bun 1.2+ | Everything |
| Browsers, edge workers (Cloudflare, Vercel Edge) | The core: compile, check, run, pause and resume. Pass the diagram as text, not a file path. No SQLite store, CLI or viewer. |
| Deno | Expected to work like Node; not tested yet |

## Imports

typemaid is ES modules only. `require('typemaid')` works on Node 22.12+ and Bun.

| Import | What it gives you |
|---|---|
| `typemaid` | `run`, `resume`, `compile`, `check`, `tool`, `agent`, `human`, `memoryStore` |
| `typemaid/ai` | `defineAI`: set the model once for agent steps and tools |
| `typemaid/sqlite` | `sqliteStore`: keep runs in a SQLite file |
| `typemaid/node` | File helpers used by the CLI and the viewer |
| `@typemaid/view` | `view()`: the workflow viewer |
| `@typemaid/postgres` | `postgresStore` |
| `@typemaid/libsql` | `libsqlStore` |

## TypeScript

Bun runs `.ts` files directly. On Node 22.18 or newer, TypeScript files with only type annotations run directly as well. Otherwise, compile with your usual setup; typemaid ships its own type definitions.

## Next

Write your first workflow in the [Quickstart](/docs/getting-started/).
