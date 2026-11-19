# Contributing to typemaid

Thanks for helping. This page covers how to set up the repository, where things live, how to test a change, and what a good pull request looks like.

## Before you start

- For a bug, open an issue with the diagram, the tools file (or the smallest part of it that shows the problem) and the output of `typemaid check`.
- For a new feature or a change to the diagram syntax, open an issue first. The `.mmd` grammar and the saved-run format are hard to change once people depend on them, so they are agreed on before code is written.
- Small fixes to docs, examples, error messages and tests are welcome without an issue.

## Set up

You need [Bun](https://bun.sh) 1.2 or newer. Node 22 or newer is needed only for the runtime checks.

```bash
bun install
bun run build       # builds typemaid and the packages in packages/
bun test            # the whole test suite
bun run typecheck
```

`bun test` uses the built files in `dist/`, so run `bun run build` after changing anything in `src/` (`bun run test` does both).

## Where things live

| Path | What it is |
|---|---|
| `src/core/` | The compiler: parses Mermaid (`parse.ts`), checks it (`compile.ts`), and the diagnostic codes and messages (`diagnostics.ts`). Pure functions, with no file system or network access. |
| `src/bind/` | Matches the diagram's nodes with the exported steps and checks their Zod schemas against each other. |
| `src/exec/` | The executor (`executor.ts`), the store interface and the in-memory store (`store.ts`), and run events. |
| `src/ai/` | `typemaid/ai`: `defineAI` and agent steps through the Vercel AI SDK. |
| `src/sqlite/` | `typemaid/sqlite`: the SQLite store. |
| `src/node/`, `src/cli.ts` | File helpers and the `typemaid` command line. |
| `packages/view/` | `@typemaid/view`, the workflow viewer. |
| `packages/postgres/`, `packages/libsql/` | The Postgres and libSQL (Turso) stores. |
| `examples/` | Runnable examples. Each folder has a `.mmd` diagram and a `tools.ts`. |
| `test/` | The core tests (Bun's test runner). |
| `docs/` | Guides in Markdown, shown on the docs site. |
| `website/` | The docs site (Astro), with its own tests. See `website/README.md`. |

## Testing your change

Every change comes with a test. Pick the place that fits:

- **A diagram the compiler should accept:** add a `.mmd` file to `test/fixtures/accept/`. Its compiled JSON is saved in `test/golden/accept/` the first time the tests run. Read that file and check it is what you expect. The official Mermaid parser also checks that the diagram is valid Mermaid with the same nodes and arrows (`test/referee.test.ts`).
- **A diagram the compiler should reject:** add a `.mmd` file to `test/fixtures/reject/`, named after the error code it should produce, for example `E1003-reserved.mmd`. The expected diagnostics are saved in `test/golden/reject/`.
- **Changed output on purpose:** run `UPDATE_GOLDEN=1 bun test`, then review every changed file in `test/golden/` before you commit it.
- **Running behaviour** (branches, loops, pauses, retries, stores): add to `test/run.test.ts`, `test/durability.test.ts` or the closest file.
- **A bug fix:** add the smallest case that failed before the fix to `test/regressions.test.ts`.
- **A new example:** add `examples/<name>/<name>.mmd` and `examples/<name>/tools.ts`, and a test that runs it in `test/examples.test.ts`. Every example diagram is also compiled and checked by the fixture tests.

Some tests need outside services and are skipped without them:

```bash
# Real Postgres or libSQL servers (the tests create and drop their own tables)
TYPEMAID_TEST_POSTGRES_URL=postgres://user@localhost:5432/postgres bun test packages/postgres
TYPEMAID_TEST_LIBSQL_URL=... TYPEMAID_TEST_LIBSQL_TOKEN=... bun test packages/libsql

# A real model: copy .env.example to .env.live and fill it in (not .env, which Bun loads for every test run)
bun run test:live
```

Before a larger change, also run:

```bash
bun run runtimes          # the same program on Bun, every Node 22+ found, and an edge-like sandbox
bun run smoke             # packs every package and installs it into an empty project
bun run check:examples    # typemaid check on every example
```

## Docs

- The guides are Markdown files in `docs/`. The docs site shows them as they are, so links between them stay relative (`[stores](stores.md)`).
- Pages written for the site are in `website/src/content/guide/`. Code examples there are filled from real files with an empty fence such as `` ```ts file=examples/hello/tools.ts ``, so the docs always show code the tests run.
- When you change behaviour, update the guide that describes it and, if it changes the syntax, the root `README.md`.
- To preview the site and run its tests:

  ```bash
  cd website
  npm install
  npm run dev       # http://localhost:4321
  npm test          # builds the site and checks every page, link and code example
  ```

## Writing style

The error messages and the docs are part of the product.

- Short sentences and plain words. Say what happened, then what to do.
- Every error has a stable code, the file and line, and a suggested fix where there is one. Codes never change meaning; message text can improve.
- Report every problem in one pass rather than stopping at the first.
- Reject syntax typemaid does not understand rather than ignoring it, so a diagram never runs differently from how it looks.

## Using an AI coding assistant

The repository is set up for AI assistants, so they follow the same rules as everyone else:

- `AGENTS.md`: the project context they read first (layout, commands, rules for tests and docs). `CLAUDE.md` points to it.
- `skills/`: step-by-step guides for common tasks (add an example, a diagnostic or a store; update the docs; check what a package uploads). Claude Code and OpenCode find them through `.claude/skills` and `.agents/skills`.
- `.claude/settings.json`, `.cursor/rules/`, `.cursorignore`, `.opencode/opencode.json`: shared settings. They allow the test and build commands, keep `.env` files out of the assistant's reach, and block publishing to npm.

Put personal settings in `.claude/settings.local.json` or `CLAUDE.local.md`; they are ignored by git. You are responsible for every line you send, whoever wrote it: read the diff and run the tests.

## Pull requests

- Keep each pull request to one change, and explain why it is needed as well as what it does.
- Check that these pass: `bun run build`, `bun test` and `bun run typecheck`. If you changed docs, also run `npm test` in `website/`.
- Don't bump version numbers or publish to npm; that is done at release time.
- Don't rename the package or the `.mmd` extension in a normal pull request. Renaming is a separate, planned change.

## Licence

typemaid is released under the Functional Source License 1.1 with an MIT future licence (`LICENSE.md`). By sending a pull request you agree that your contribution is released under the same licence.
