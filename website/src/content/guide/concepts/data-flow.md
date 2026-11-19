Every run has one shared set of fields. Steps read from it and write to it by name.

## How fields move

1. `run(flow, tools, input)` starts the shared fields with `input`.
2. Before a step runs, typemaid picks the fields its `input` schema names out of the shared set and checks them.
3. The step's output is checked against its `output` schema and merged into the shared set.
4. When the run ends, the shared set is the run's `output`.

The [hello example](/docs/examples/hello/) shows it end to end:

```ts
const result = await run('./hello.mmd', tools, { name: 'Ada' });
// greet reads `name`, writes `greeting`; shout reads `greeting`, writes `loud`
// result.output: { name: 'Ada', greeting: 'Hello, Ada', loud: 'HELLO, ADA!' }
```

## Checked before anything runs

typemaid works out, from the diagram and the schemas, which fields each step can rely on. Fields that no step before it produces must be passed to `run()`. If one is missing, `run()` throws a `FlowError` before any step runs, rather than failing halfway.

Optional fields (`z.string().optional()`) are not required. That is how a step can read a field that only some paths produce, such as `note` in the [support triage](/docs/examples/support-triage/) example.

## Later writes win

When two steps write the same field, the later write replaces the earlier one. Loops use this: in the [review loop](/docs/examples/review-loop/), each pass of `draft` replaces `version` and `text`.

## Answers from people

When a [human step](/docs/guides/pausing/) is resumed, the answer's fields are checked against its `resume` schema and merged in like any other output, including `decision` when the box has `approved` and `rejected` arrows.

## For-each results

A [for-each block](/docs/concepts/control-flow/#for-each) runs once per list item. Each item's outputs are kept apart and collected, in input order, into a list named after the block:

```ts
// subgraph each["for email in emails"] … end
// output.each: [{ isSpam: false, action: 'replied', … }, { isSpam: true, action: 'archived' }, …]
```

## Values are JSON

Runs are saved as JSON, so field values must be JSON values. Dates become strings and `undefined` is dropped. Keep secrets out of fields; pass them as `auth` to `run()` instead, which tools read as `ctx.auth` and which is never stored.
