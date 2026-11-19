Turn Mermaid text into a flow, or list its problems. Both are from `typemaid` and work in every runtime, including browsers.

## compile()

```ts
import { compile } from 'typemaid';

function compile(source: string, options?: CompileOptions): CompiledFlow;
```

Returns a compiled flow you can pass to `run()`. Throws a `FlowError` if the diagram has errors. Use it when the diagram text comes from someone you do not trust, so a string is never read as a file path:

```ts
const flow = compile(userText, { file: 'user-flow.mmd' });
await run(flow, tools, input);
```

## check()

```ts
import { check } from 'typemaid';

function check(source: string, options?: CompileOptions): {
  flow?: CompiledFlow;      // present when there are no errors
  diagnostics: Diagnostic[];
  source: string;
};
```

Never throws for problems in the diagram; they are returned. `check()` covers the diagram itself. Problems with the tools (missing exports, missing inputs) are found when the flow is bound to tools in `run()`, or by `typemaid check`, which loads the tools file.

## CompileOptions

| Option | Type | Description |
|---|---|---|
| `file` | `string` | Shown in diagnostics, e.g. `flows/hello.mmd:2:13`. |
| `limits` | `{ maxNodes?, maxEdges?, maxLoopCap? }` | Reject diagrams that are too large. `maxNodes` defaults to 500 and `maxEdges` to 2000. |

## Diagnostic

| Field | Type | Description |
|---|---|---|
| `code` | `string` | Stable code such as `E1201`. Messages may change between releases; codes do not. |
| `severity` | `'error' \| 'warning'` | Errors stop the run; warnings do not. |
| `message` | `string` | What is wrong. |
| `hint` | `string` | A suggested fix, when there is one. |
| `file` | `string` | The diagram file, when known. |
| `line`, `column` | `number` | 1-based position; `0` when the problem has no position. |

## Formatting

```ts
import { formatDiagnostics } from 'typemaid';

console.error(formatDiagnostics(result.diagnostics, result.source));
// flows/hello.mmd:2:13  error E1201  The box `shuot` needs a tool named `shuot` …
```

## FlowError

Thrown by `compile()` and `run()`. `error.message` is the formatted list; `error.diagnostics` holds the problems.
