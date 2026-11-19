# @typemaid/postgres

Saves [typemaid](https://typemaid.pages.dev/docs/) runs in Postgres, so paused and failed runs survive restarts and several servers can share them.

```bash
npm install @typemaid/postgres pg
```

```ts
import { Pool } from 'pg';
import { run, resume } from 'typemaid';
import { postgresStore } from '@typemaid/postgres';

const store = postgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));

const result = await run('./flows/refund.mmd', tools, input, { store });
// Later, in any process that can reach the same database:
await resume(result.runId, tools, { approved: true }, { store });
```

You own the connection: the store never opens or closes one. It has no dependencies of its own. It accepts a `Pool` or `Client` from `pg`, and any client with the same `query(sql, params)` function (Neon, Vercel Postgres, PGlite).

## Options

```ts
postgresStore(pool, { table: 'app.workflow_runs', createTable: false });
```

| Option | Default | Meaning |
|---|---|---|
| `table` | `flow_runs` | Table name, optionally as `schema.table`. Letters, digits and `_` only. |
| `createTable` | `true` | The table is created on first use. Set to `false` if you keep your own migrations. |

For your own migrations, `postgresSchema(table?)` returns the `CREATE TABLE IF NOT EXISTS` statement.

## The table

One row per run, keyed by `tenant` and `run_id`.

| Column | Type | |
|---|---|---|
| `tenant`, `run_id` | `TEXT` | Primary key. |
| `version` | `INTEGER` | Goes up by one on every save. |
| `status` | `TEXT` | `running`, `paused`, `completed` or `failed`. |
| `flow_hash`, `flow` | `TEXT` | The diagram as it was when the run started. Written once. |
| `body` | `TEXT` | The rest of the run, as JSON. |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

You can read these with plain SQL, for example to list paused runs. Do not change rows by hand. Finished runs are not deleted for you.

## Good to know

- **Two workers cannot both continue the same run.** Every save is one `UPDATE ... WHERE version = $n`. The worker that loses gets `StaleRunError` and must stop.
- **`body` is `TEXT`, not `JSONB`,** so a run comes back exactly as it was saved.
- It needs `typemaid` of the same version installed next to it.

## Tests

`bun test packages/postgres` runs the shared store tests on PGlite (Postgres inside the test process). To also run them on a real server through `pg`, set `TYPEMAID_TEST_POSTGRES_URL`. The tests create and drop their own schema.

Licence: FSL-1.1-MIT (see `LICENSE.md`).
