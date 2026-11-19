Answer a paused run, retry a failed one from the step that failed, or continue a run whose process died.

```ts
import { resume } from 'typemaid';

function resume(
  runId: string,
  tools: Tools,
  answer?: Record<string, unknown>,
  options?: ResumeOptions,
): Promise<RunResult>;
```

## Parameters

| Parameter | Type | Description |
|---|---|---|
| `runId` | `string` | The `runId` from an earlier result. |
| `tools` | `Tools` | The same tools the run was started with. |
| `answer` | `Record<string, unknown>` | For a paused run: the person's answer, checked against the human step's `resume` schema. Include `decision` when the step has `approved`/`rejected` arrows. Leave out to retry or continue. |
| `options` | `ResumeOptions` | The same as [`run()` options](/docs/api/run/#options) except `runId` and `start`, plus `node`. |

| Option | Type | Description |
|---|---|---|
| `store` | `Store` | The store the run was saved in. Required in practice: the default in-memory store only works inside the same process. |
| `node` | `string` | Which waiting step the answer is for, when several are waiting. |

## Returns

A `RunResult`, the same as [`run()`](/docs/api/run/#returns). Resuming a completed run returns its result again.

## Throws

- The run is not in the store.
- The run was saved by a version of typemaid with a different run format.
- An answer was given but the run is not waiting for one.
- Several steps are waiting and `node` was not given, or `node` is not one of them.
- `decision` is missing or not one of the step's options.

## Example

```ts
import { resume } from 'typemaid';
import { sqliteStore } from 'typemaid/sqlite';
import * as tools from './flows/tools.ts';

const store = sqliteStore('./runs.db');

// A person approved:
await resume(runId, tools, { decision: 'approved', note: 'ok' }, { store });

// Retry a failed run from the step that failed:
await resume(runId, tools, {}, { store });
```
