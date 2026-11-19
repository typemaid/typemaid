---
name: add-store
description: Add a typemaid store package that saves runs in a new database (like @typemaid/postgres), and prove it with the shared store contract tests. Use when asked to support a new database or storage backend.
---

# Add a store

A store saves runs so they survive restarts and can be shared by several workers. Copy the shape of `packages/postgres` (or `packages/libsql`, the smaller one).

## 1. The interface

From `src/exec/store.ts`:

```ts
interface Store {
  create(record: RunRecord): Promise<void>;
  load(tenant: string, runId: string): Promise<RunRecord | undefined>;
  save(record: RunRecord, expectedVersion: number): Promise<void>;
}
```

- Key every run by tenant and run ID.
- `save` must be atomic and must replace the run only if its stored version equals `expectedVersion`; otherwise throw `StaleRunError` (exported from `typemaid`). This is what stops two workers from both continuing one run.
- Store the record as JSON exactly as given; `load` must return an equal object.
- Don't import the database driver at the top of the core. The store package takes a client (or connection) the user created, and lists the driver as a peer dependency.

## 2. The package

Create `packages/<name>/` with `package.json` (name `@typemaid/<name>`, same version as the other packages, `peerDependencies: { "typemaid": "<that version>" }` plus the driver, `devDependencies: { "typemaid": "workspace:*" }`, `publishConfig.access: public`, `files: ["dist"]`), `src/index.ts`, `tsconfig.json`, `tsdown.config.ts`, `README.md` and `LICENSE.md` (copy them from `packages/postgres` and adapt).

## 3. Tests

In `packages/<name>/test/<name>.test.ts`, run the shared contract:

```ts
import { storeContract } from '../../../test/store-contract.ts';

storeContract('<name> store', () => myStore(freshClient()), {
  pair: async () => { /* two stores on the same data, for the concurrency tests */ },
});
```

`make` must return an empty store each time (a new table or database). If the database needs a server, add a second contract run that is skipped unless an environment variable like `TYPEMAID_TEST_<NAME>_URL` is set, and list that variable in `.env.example`.

```bash
bun run build && bun test packages/<name>
```

## 4. Wire it up

- `scripts/smoke.sh`: pack the new package and check it installs with one copy of the core.
- `website/src/content/guide/api/stores.md` and `docs/stores.md`: how to install and use it.
- Run `bun run typecheck && bun run lint:pkg && bun run smoke`.
