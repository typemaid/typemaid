---
name: add-diagnostic
description: Add a new typemaid error or warning code (E1xxx / W1xxx), with its fixture, golden output and docs. Use when the compiler, binder or runner should report a new kind of problem.
---

# Add a diagnostic

Diagnostics are part of the public API: tools, editors and AI agents parse the codes. A code never changes meaning once released; only the message text may improve.

## 1. Pick the code

| Range | Raised by | Where |
|---|---|---|
| `E10xx` | Diagram syntax | `src/core/parse.ts`, `src/core/compile.ts` |
| `E11xx` | Graph structure (starts, ends, loops, decisions, for-each) | `src/core/compile.ts` |
| `E12xx` | Binding the diagram to the exported steps and their schemas | `src/bind/bind.ts` |
| `E13xx` | Running (input, step results, resume) | `src/index.ts`, `src/exec/executor.ts` |
| `W1xxx` | Warnings, in the same ranges | same files |

List the codes in use with:

```bash
grep -ohE "'[EW]1[0-9]{3}'" -r src | sort -u
```

Take the next free number in the right range. Never reuse a removed code.

## 2. Report it

Use the `Diagnostics` collector from `src/core/diagnostics.ts`:

```ts
diags.error('E1115', 'What is wrong, naming the node: `review` has no way out.', { line, column }, 'What to do about it.');
```

- Message: one plain sentence, naming the node or field in backticks. Say what is wrong, not what the code expected internally.
- Position: always give the line and column of the node or arrow at fault.
- Hint (the last argument): a concrete fix. If a name is close to a real one, suggest it ("Did you mean `shout`?"); `suggest()` in `diagnostics.ts` finds near matches.
- Keep collecting: report every problem in one pass, don't stop at the first.

## 3. Test it

- For a diagram problem, add `test/fixtures/reject/<CODE>-<short-name>.mmd`. The test checks that `<CODE>` is among the errors, that every error has a line, and compares the formatted output with `test/golden/reject/<CODE>-<short-name>.txt` (written on the first run: read it).
- For a binding or run-time problem, add a case to `test/bind.test.ts` or `test/run.test.ts` that asserts the code.
- If you changed the wording of existing messages on purpose: `UPDATE_GOLDEN=1 bun test`, then review every changed golden file.

```bash
bun run build && bun test
```

## 4. Document it

If users will meet it often, mention it in `website/src/content/guide/guides/checking.md` with the CLI output and the fix.
