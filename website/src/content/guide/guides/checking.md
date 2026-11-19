typemaid checks a diagram and its tools before anything runs. The same checks run inside `run()`, from the CLI, and in the viewer.

## From the command line

```bash
npx typemaid check flows
```

It reports each problem with the file, line, a code and a suggested fix, and exits with code 1 on errors:

```
flows/hello.mmd:2:13  error E1201  The box `shuot` needs a tool named `shuot`, and there is none in the tools you passed. Did you mean `shout`?
   2 |   greet --> shuot
     |             ^
```

Pass `--json` for machine-readable output, and `--tools <file>` if the tools file is not next to the diagram (`tools.ts`, `tools.mts`, `tools.js` or `tools.mjs`).

## What is checked, in order

Checks run in stages, so you fix the basics first:

1. **Syntax:** every Mermaid problem at once (unsupported arrows, shapes or directives).
2. **Structure:** once the syntax is clean: loops (every loop needs a `max`), start nodes and parallel blocks.
3. **Tools and data:** boxes with no matching export, `:::agent`/`:::human` hints that do not match, fields a step needs that nothing provides.

## From code

`check()` returns problems instead of throwing:

```ts
import { check, formatDiagnostics } from 'typemaid';

const result = check(text, { file: 'flows/hello.mmd' });
if (result.diagnostics.length > 0) console.error(formatDiagnostics(result.diagnostics, result.source));
```

`compile()` and `run()` throw a `FlowError` instead. Its message is the same formatted list, and `error.diagnostics` holds the problems:

```ts
import { FlowError, run } from 'typemaid';

try {
  await run('./hello.mmd', tools, {});
} catch (error) {
  if (error instanceof FlowError) console.error(error.message);
  // examples/hello/hello.mmd:2:3  error E1301  run() is missing input: name (needed by `greet`).
}
```

See [`compile()` and `check()`](/docs/api/compile/).
