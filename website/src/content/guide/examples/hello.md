The smallest workflow: two typed steps in a row. Start here if you are new.

## The diagram

```mermaid file=examples/hello/hello.mmd
```

## The steps

Each box is an export. `greet` reads `name` and writes `greeting`; `shout` reads `greeting` and writes `loud`.

```ts file=examples/hello/tools.ts
```

## Run it

```ts file=examples/hello/index.ts
```

```bash
bun examples/hello/index.ts
```

```json
{
  "status": "completed",
  "runId": "…",
  "output": { "name": "Ada", "greeting": "Hello, Ada", "loud": "HELLO, ADA!" }
}
```

Or from the command line, without an `index.ts`:

```bash
npx typemaid run examples/hello/hello.mmd --input '{"name":"Ada"}'
```

## What to try

- Misspell `shout` in the diagram and run `npx typemaid check examples/hello`: you get the line and a "did you mean" fix.
- Leave out `name` from the input: `run()` throws before any step runs, naming the missing field.
- Next: add a person to the loop in [Support triage](/docs/examples/support-triage/).
