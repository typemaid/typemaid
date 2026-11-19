`run()` starts a run and keeps going until the run completes, pauses for a person, or fails.

## Results

`run()` and `resume()` return one of three shapes:

```ts
{ status: 'completed', runId, output }
{ status: 'paused',    runId, waitingAt: [{ node, label, fields, options }] }
{ status: 'failed',    runId, error: { code, message, node } }
```

- **completed:** `output` is the run's final shared fields.
- **paused:** `waitingAt` lists the human steps waiting for an answer: the node, its label, the fields the answer may contain, and the `decision` options when the box has `approved`/`rejected` arrows. Continue with [`resume()`](/docs/api/resume/).
- **failed:** a step failed after its retries, or a limit was reached. `error.node` is the step. You can retry from that step with `resume()`.

A real paused result from the [support triage example](/docs/examples/support-triage/):

```json
{
  "status": "paused",
  "runId": "fea25886-…",
  "waitingAt": [
    {
      "node": "approve",
      "label": "Manager approval",
      "fields": { "note": { "kind": "string", "required": false } },
      "options": ["approved", "rejected"]
    }
  ]
}
```

## Why a run fails

When a run fails, `error.code` says why and `error.node` names the step:

| Code | What happened | Retried |
|---|---|---|
| `E1321` | The step's code threw an error. | Yes, with `retries` |
| `E1324` | One try took longer than its time limit. | Yes, with `retries` |
| `E1342` | A model call failed. | Yes, with `retries` |
| `E1320` | The step's input does not match its `input` schema. | No |
| `E1322` | The step returned something that does not match its `output` schema, or not an object. | No |
| `E1323` | A model's answer does not match the output schema, even after the model was asked once more. | No |
| `E1325` | The step returned a field named `__proto__`, `constructor` or `prototype`. | No |
| `E1311` | A step chose an arrow label that the diagram does not have. | No |
| `E1312` | A decision got a value that is not true or false. | No |
| `E1313` | A loop reached its `max`. | No |
| `E1314` | A for-each block was given something that is not a list. | No |
| `E1310` | The run went past `maxSteps`. | No |
| `E1326` | The shared fields grew past `maxContextChars`. | No |
| `E1340` | An agent step has no model set. | No |
| `E1341` | An agent step needs the `ai` package, and it is not installed. | No |
| `E1330` | The run was cancelled. | No |
| `E1399` | Any other error. | No |

Errors that are not retried would give the same result on a second try. Fix the cause, then call [`resume()`](/docs/api/resume/) to start again at the failed step. This needs a [store](/docs/stores/).

A step can also run twice without failing: if the process stops after a step finishes but before its result is saved, the step runs again on resume. See [Durability](/docs/durability/#at-least-once).

## Errors that throw

Problems that make a run impossible are thrown, not returned, and nothing runs:

- the diagram has a mistake, or a box has no matching export;
- a required input is missing, or the input is not an object;
- `start` names a node that is not an entry point.

These throw a `FlowError`. Its message lists every problem with file, line and a fix, the same as [`typemaid check`](/docs/guides/checking/).

## Run IDs and stores

Every run has a `runId`. Pass your own with `run(…, { runId })`, for example to tie a run to a ticket. Runs are kept in the `store` you pass, or in memory when you pass none; memory runs are lost when the process exits. See [Stores](/docs/stores/).

## Watching a run

`onEvent` is called as the run moves:

```ts
await run('./triage.mmd', tools, input, {
  onEvent: (event) => console.log(event.type, 'node' in event ? event.node : ''),
});
```

| Event | When |
|---|---|
| `run.start` | The run starts, with its entry node. |
| `node.start`, `node.end` | A step starts or ends (`ms` on end). |
| `node.retry` | A step failed and will be tried again. |
| `branch` | A decision or choice took an arrow. |
| `run.paused` | A human step is waiting. |
| `run.end` | The run completed, paused or failed. |

## Cancelling

Pass an `AbortSignal` as `signal`. Running steps see it through `ctx.signal`.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);
await run('./flow.mmd', tools, input, { signal: controller.signal });
```

## Limits

`limits` protects a run from growing without bound:

| Limit | Default | Meaning |
|---|---|---|
| `maxSteps` | 10 000 | Most step executions in one run. |
| `timeoutMs` | 5 minutes | Default time limit for one try of one step. |
| `concurrency` | 5 | For-each items that run at the same time. |
| `maxContextChars` | 5 000 000 | Largest shared fields, in characters of JSON. |

See [Retries and time limits](/docs/retries/) for retries, timeouts and loop caps.
