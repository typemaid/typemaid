# @typemaid/libsql

Saves [typemaid](https://typemaid.pages.dev/docs/) runs in libSQL: a local file, a libSQL server, or Turso. Paused and failed runs survive restarts, and several servers can share them.

```bash
npm install @typemaid/libsql @libsql/client
```

```ts
import { createClient } from '@libsql/client';
import { run, resume } from 'typemaid';
import { libsqlStore } from '@typemaid/libsql';

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const store = libsqlStore(client);

const result = await run('./flows/refund.mmd', tools, input, { store });
// Later, in any process that can reach the same database:
await resume(result.runId, tools, { approved: true }, { store });
```

You own the client: the store never opens or closes one. It has no dependencies of its own; it uses only the client's `execute` function. For a local file, use `createClient({ url: 'file:./runs.db' })`.

On one server with no other need for libSQL, the built-in `typemaid/sqlite` store does the same job with nothing to install.

## Options

```ts
libsqlStore(client, { table: 'workflow_runs', createTable: false });
```

| Option | Default | Meaning |
|---|---|---|
| `table` | `flow_runs` | Table name. Letters, digits and `_` only. |
| `createTable` | `true` | The table is created on first use. Set to `false` if you keep your own migrations. |

For your own migrations, `libsqlSchema(table?)` returns the `CREATE TABLE IF NOT EXISTS` statement.

## The table

One row per run, keyed by `tenant` and `run_id`. Columns: `version`, `status` (`running`, `paused`, `completed` or `failed`), `flow_hash` and `flow` (the diagram as it was when the run started, written once), `body` (the rest of the run, as JSON), `created_at` and `updated_at` (ISO dates as text).

You can read these with plain SQL, for example to list paused runs. Do not change rows by hand. Finished runs are not deleted for you.

## Good to know

- **Two workers cannot both continue the same run.** Every save is one `UPDATE ... WHERE version = ?`. The worker that loses gets `StaleRunError` and must stop.
- **With a Turso embedded replica,** writes go to the remote database, but a read can be slightly behind until the next sync. A stale read cannot damage a run (the save is refused), but a `resume()` right after a save from another server may not see it yet.
- It needs `typemaid` of the same version installed next to it.

## Tests

`bun test packages/libsql` runs the shared store tests on local database files. To also run them on a server, set `TYPEMAID_TEST_LIBSQL_URL` (and `TYPEMAID_TEST_LIBSQL_TOKEN` if it needs one). The tests create and drop their own tables.

Licence: FSL-1.1-MIT (see `LICENSE.md`).
