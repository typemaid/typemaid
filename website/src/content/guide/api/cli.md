The `typemaid` command checks, runs, resumes and views workflows. Run it with `npx typemaid`, `bunx typemaid`, or from a package script.

## typemaid check

```bash
typemaid check [files or folders...] [--tools <file>] [--json]
```

Checks diagrams and their tools. Prints each problem with file, line and a fix, and exits with code 1 on errors. `--json` prints machine-readable output. See [Checking and errors](/docs/guides/checking/).

## typemaid run

```bash
typemaid run <flow.mmd> [--input <json | @file>] [--start <node>] [--tools <file>] [--store <file.db>]
```

Runs a workflow and prints the result. The tools file next to the diagram (`tools.ts`, `tools.mts`, `tools.js` or `tools.mjs`) is used unless you pass `--tools`. `--input @input.json` reads the input from a file. Pass `--store` if the flow can pause, so it can be resumed:

```bash
typemaid run flows/triage.mmd --input '{"ticketId":"T-URGENT"}' --store runs.db
```

## typemaid resume

```bash
typemaid resume <runId> --store <file.db> --tools <file> [--answer <json | @file>] [--node <node>]
```

Answers a paused run, or retries a failed one when no `--answer` is given.

## typemaid view

```bash
typemaid view [files or folders...] [--port <n>] [--no-open] [--no-tools] [--tools <file>]
```

Opens the [workflow viewer](/docs/guides/viewer/). Needs `@typemaid/view`.

## view()

```ts
import { view } from '@typemaid/view';

function view(target?: string | string[], options?: ViewOptions): Promise<{
  url: string;
  port: number;
  toolsFiles: string[];   // tools files whose code was loaded
  close(): Promise<void>;
}>;
```

| Option | Type | Default | Description |
|---|---|---|---|
| `open` | `boolean` | `false` | Open the page in the browser. |
| `port` | `number` | `4747` | The next free port is used if it is taken. |
| `strictPort` | `boolean` | `false` | Fail instead of moving to another port. |
| `host` | `string` | `'127.0.0.1'` | This machine only. The viewer has no login; widen with care. |
| `allowedHosts` | `string[]` | | Extra host names the viewer may be reached under. |
| `tools` | `string \| false` | next to each diagram | A tools file for every diagram, or `false` to load no code. |
| `watch` | `boolean` | `true` | Refresh the page when files change. |
