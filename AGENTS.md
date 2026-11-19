# AGENTS.md

Context for AI coding assistants (Claude Code, Cursor, OpenCode, Codex, GitHub Copilot and others) working in the typemaid repository. People should read [CONTRIBUTING.md](CONTRIBUTING.md); it says the same things at more length.

## What typemaid is

A TypeScript SDK that runs workflows drawn as Mermaid flowcharts. Each box in a `.mmd` diagram is a step exported from a `tools.ts` file (`tool()`, `agent()` or `human()`), typed with Zod. The diagram decides what runs next. Runs can pause for a person and resume later, retry steps, be saved to a store, and call models through the Vercel AI SDK.

- Docs: https://typemaid.pages.dev (source in `docs/` and `website/`)
- npm: `typemaid`, `@typemaid/view`, `@typemaid/postgres`, `@typemaid/libsql`
- Licence: FSL-1.1-MIT (source-available; each release becomes MIT after two years). Do not call it "open source" in docs or messages.

## Repository layout

| Path | What it is |
|---|---|
| `src/core/` | The compiler. `parse.ts` reads Mermaid, `compile.ts` checks the graph and produces plain JSON, `expr.ts` is the condition language, `diagnostics.ts` holds the diagnostic type. Pure functions: no file system, network, `eval` or imports at run time. |
| `src/bind/` | Matches diagram nodes to exported steps and checks their Zod schemas against each other. |
| `src/exec/` | The executor (`executor.ts`), the `Store` interface and `memoryStore` (`store.ts`), run events. |
| `src/ai/` | `typemaid/ai`: `defineAI`, agent steps through the Vercel AI SDK (loaded only when used). |
| `src/sqlite/` | `typemaid/sqlite`: the SQLite store. |
| `src/node/`, `src/cli.ts` | File helpers and the `typemaid` CLI (`check`, `run`, `resume`, `view`). |
| `src/brand.ts` | The product name, CLI name, file extensions and version. Nothing else in `src/` may contain the name. |
| `packages/view` | `@typemaid/view`, the local workflow viewer (server in `src/`, page in `ui/`). |
| `packages/postgres`, `packages/libsql` | Stores for Postgres and libSQL/Turso. |
| `examples/` | Runnable examples: `<name>/<name>.mmd` plus `tools.ts`. Shown in the docs and run by the tests. |
| `test/` | Core tests (Bun's test runner). `fixtures/accept` and `fixtures/reject` with saved output in `golden/`. |
| `docs/` | Guides in Markdown, shown on the docs site as written. |
| `website/` | The docs site (Astro), with its own Vitest tests. Not part of any npm package. |
| `skills/` | Task guides for AI assistants (also linked from `.claude/skills` and `.agents/skills`). |

## Commands

Bun 1.2+ for development. Node 22+ is needed only for `bun run runtimes`.

| Command | What it does |
|---|---|
| `bun install` | Install everything (one hoisted `node_modules` for the workspace) |
| `bun run build` | Build the core and the three packages into `dist/` |
| `bun test` | All core and package tests. They import the built files, so build first |
| `bun run test` | Build, then test |
| `bun run typecheck` | TypeScript for the core and every package |
| `bun run lint:pkg` | publint and "are the types wrong" on all four packages |
| `bun run check:examples` | `typemaid check` on every example |
| `bun run smoke` | Pack every package and install it into an empty project |
| `bun run runtimes` | Run the same program on Bun, every Node 22+ found, and an edge-like sandbox |
| `UPDATE_GOLDEN=1 bun test` | Rewrite the saved outputs in `test/golden/` after an intended change |
| `cd website && npm test` | Build the docs site and run its unit and page tests |

Before saying a change is done: `bun run build && bun test && bun run typecheck`. If you touched packaging, also `bun run lint:pkg && bun run smoke`. If you touched docs, also `cd website && npm test`.

## Rules for changes

- **Every change has a test.** Accepted diagram: a fixture in `test/fixtures/accept/`. Rejected diagram: `test/fixtures/reject/<CODE>-<name>.mmd`. Bug: the smallest failing case in `test/regressions.test.ts`. Behaviour: `test/run.test.ts` or `test/durability.test.ts`.
- **Golden files are output, not input.** Never edit `test/golden/` by hand. Regenerate with `UPDATE_GOLDEN=1 bun test` and read every changed file.
- **Every accepted diagram must render in stock Mermaid.** `test/referee.test.ts` checks this with the official parser. Never add syntax Mermaid can't draw.
- **Reject what isn't understood; never ignore it.** A diagram must not run differently from how it looks.
- **Diagnostics:** stable codes (`E10xx` diagram syntax, `E11xx` graph structure, `E12xx` binding to steps and schemas, `E13xx` running; `W` for warnings in the same ranges). Codes never change meaning; messages may improve. Give the file, line and a suggested fix. Report every problem in one pass.
- **The root import stays small.** No new runtime dependencies in the core. Optional features load lazily (see how `src/ai/adapter.ts` imports `ai`).
- **Stored runs and the `.mmd` grammar are public API.** Changes to either need an issue and a discussion first.
- **Stores** must pass `storeContract()` from `test/store-contract.ts`.
- **Examples** in `examples/` must have a test in `test/examples.test.ts`; the docs embed them with `file=` code fences.
- Don't bump versions, edit `CHANGELOG.md` by hand, publish, or rename the package or the `.mmd` extension as part of a normal change.

## Writing style

Docs, error messages, comments and commit messages:

- Short sentences and plain words. Say what happened, then what to do.
- Write for someone new to the project. Don't refer to past versions of the code or to how a change was made.
- No marketing language. Every claim must be true of the code; check it.

## Secrets

Never read, print or commit `.env`, `.env.live` or other `.env.*` files (only `.env.example` is shared). The live model test and the real database tests read credentials from the environment and are skipped without them.

## Skills

Step-by-step guides for common tasks are in `skills/`:

- `add-example`: a new runnable example, its test and its docs page
- `add-diagnostic`: a new error or warning code
- `add-store`: a new store package
- `update-docs`: change the guides or the docs site
- `check-package-contents`: see exactly what a package would upload to npm
