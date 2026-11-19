#!/usr/bin/env bash
# Packs every package, installs the core tarball into an empty project (with zod only, no optional
# peers) using Bun, and checks that every entry point and the CLI work from there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"
bun run build >/dev/null 2>&1
bun pm pack --destination "$WORK/core" --quiet >/dev/null
for name in view postgres libsql; do
  (cd "packages/$name" && bun pm pack --destination "$WORK/$name" --quiet >/dev/null)
done
TARBALL="$(ls "$WORK"/core/*.tgz)"
VIEW_TARBALL="$(ls "$WORK"/view/*.tgz)"
cd "$WORK"
echo '{ "name": "smoke", "private": true, "type": "module" }' > package.json
bun add "$TARBALL" zod >/dev/null 2>&1
mkdir flows
cat > flows/hello.mmd <<'MAID'
flowchart TD
  greet --> done([Done])
MAID
cat > flows/tools.ts <<'TS'
import { z } from 'zod';
import { tool } from 'typemaid';
export const greet = tool({
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  run: ({ name }) => ({ greeting: `Hello, ${name}` }),
});
TS
cat > main.ts <<'TS'
import { run, human, memoryStore } from 'typemaid';
import { sqliteStore } from 'typemaid/sqlite';
import { defineAI } from 'typemaid/ai';
import * as tools from './flows/tools.ts';
const a = await run('./flows/hello.mmd', tools, { name: 'Ada' });
if (a.status !== 'completed' || a.output.greeting !== 'Hello, Ada') throw new Error('run failed: ' + JSON.stringify(a));
const store = sqliteStore('./runs.db');
const b = await run('flowchart TD\n  ask', { ask: human() }, {}, { store });
if (b.status !== 'paused') throw new Error('expected a paused run');
store.close();
if (typeof memoryStore !== 'function' || typeof defineAI({ model: 'x' }).agent !== 'function') throw new Error('missing export');
console.log('library ok');
TS
bun main.ts
bun -e "const m = require('typemaid'); if (typeof m.run !== 'function') throw new Error('require failed'); console.log('require ok')"
bunx --bun typemaid check flows
bunx --bun typemaid run flows/hello.mmd --input '{"name":"Ada"}' 2>/dev/null | grep -q '"Hello, Ada"' && echo "cli ok (bun)"
if command -v node >/dev/null; then
  rm -f runs.db
  node main.ts >/dev/null && echo "also works on node $(node -v)"
fi
test ! -d node_modules/ai && echo "ai not installed: ok"
echo "installed packages: $(ls node_modules | grep -v '^\.' | wc -l | tr -d ' ')"
test ! -d node_modules/typemaid/dist/ui && echo "core has no viewer page: ok"
# Without the viewer package, the command says how to get it.
if bunx --bun typemaid view flows --no-open >/dev/null 2>hint.txt; then echo "view should fail without the viewer package"; exit 1; fi
grep -q '@typemaid/view' hint.txt && echo "view without the viewer package: install hint ok"

# With the viewer package installed next to the core.
bun add "$VIEW_TARBALL" >/dev/null 2>&1
cat > viewer.ts <<'TS'
import { view } from '@typemaid/view';
const viewer = await view('./flows', { port: 48190, watch: false, open: false });
const flows = await (await fetch(viewer.url + 'api/v1/flows')).json();
const page = await (await fetch(viewer.url)).text();
await viewer.close();
if (flows.flows.length !== 1 || !page.includes('viewer-config')) throw new Error('viewer failed');
console.log('viewer ok');
TS
bun viewer.ts
if command -v node >/dev/null; then node viewer.ts >/dev/null && echo "viewer also works on node $(node -v)"; fi
test "$(ls -d node_modules/typemaid node_modules/.bun/typemaid* 2>/dev/null | wc -l | tr -d ' ')" = "1" && echo "one copy of the core: ok"

# The stores, each with the database client a project would install with it.
bun add "$(ls "$WORK"/postgres/*.tgz)" "$(ls "$WORK"/libsql/*.tgz)" @electric-sql/pglite @libsql/client >/dev/null 2>&1
cat > stores.ts <<'TS'
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@libsql/client';
import { run, resume, human, StaleRunError, type Store } from 'typemaid';
import { postgresStore } from '@typemaid/postgres';
import { libsqlStore } from '@typemaid/libsql';
async function check(name: string, store: Store) {
  const tools = { ask: human() };
  const paused = await run('flowchart TD\n  ask', tools, {}, { store });
  const record = (await store.load('default', paused.runId))!;
  // The store must throw the class this project's copy of the core checks for.
  const stale = await store.save(record, record.version - 1).then(() => undefined, (e) => e);
  if (!(stale instanceof StaleRunError)) throw new Error(name + ': a stale save was not refused');
  const done = await resume(paused.runId, tools, {}, { store });
  if (done.status !== 'completed') throw new Error(name + ': ' + JSON.stringify(done));
  console.log(name + ' store ok');
}
const pg = new PGlite();
await check('postgres', postgresStore(pg));
await pg.close();
const client = createClient({ url: 'file:./libsql-' + process.pid + '.db' });
await check('libsql', libsqlStore(client));
client.close();
TS
bun stores.ts
if command -v node >/dev/null; then node stores.ts >/dev/null && echo "stores also work on node $(node -v)"; fi
test "$(ls -d node_modules/typemaid node_modules/.bun/typemaid* 2>/dev/null | wc -l | tr -d ' ')" = "1" && echo "still one copy of the core: ok"
