---
name: add-example
description: Add a runnable typemaid example (a .mmd diagram plus tools.ts), its test, and its page on the docs site. Use when asked to add, write or show a new example workflow.
---

# Add an example

Examples are real code: the tests run them, `typemaid check` checks them, and the docs site embeds them from disk. An example that isn't tested must not appear in the docs.

## 1. Write the files

Create `examples/<name>/`:

- `<name>.mmd`: the diagram. The file name matches the folder (`test/examples.test.ts` loads `examples/<name>/<name>.mmd`).
- `tools.ts`: one export per box in the diagram, using `tool()`, `agent()` or `human()` with Zod `input`/`output` schemas.
- `index.ts` (optional): a short script that calls `run()` and prints the result. If it needs a model, read the provider's usual environment variable (for example `ANTHROPIC_API_KEY`) and say so in the first comment.

Keep it small: show one idea (a loop, a for-each block, a human step) and nothing else.

## 2. Check it

```bash
bun run build
bun dist/cli.mjs check examples/<name>
```

Fix every error. Warnings are fine only if the example exists to show them.

## 3. Test it

Add a case to `test/examples.test.ts`: import `../examples/<name>/tools.ts` and assert the result with `toMatchObject` (status and the output fields that matter). For agent steps, pass a fake model (see the `summarize` cases). For human steps, run, check `status: 'paused'`, then `resume()` with a `memoryStore()`.

The diagram is also picked up automatically by the fixture tests: it must compile, match its saved JSON in `test/golden/accept/example-<name>.json` (created on the first run; read it), and pass the Mermaid referee.

```bash
bun test
```

## 4. Document it

1. Add `website/src/content/guide/examples/<name>.md`. No `# Title` (the layout adds it). Embed the files with empty fences:

   ````md
   ```mermaid file=examples/<name>/<name>.mmd
   ```
   ````

2. Add the page to the "Examples" section in `website/src/lib/nav.ts`: `slug: 'examples/<name>'`, a title, and a description of 50 to 160 characters.
3. Run `cd website && npm test`. It fails if a shown example isn't in `test/examples.test.ts`, or if any link or code block is wrong.
