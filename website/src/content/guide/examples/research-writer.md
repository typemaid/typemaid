An AI workflow that writes a blog post. One agent plans it, two searches run at the same time, a second agent writes the draft, and an AI judge scores it. The draft is revised until the judge gives it 8 or more, then the run pauses until an editor approves it. It shows agent steps, parallel branches, a loop driven by a model's score, and a person in the loop.

## The diagram

```mermaid file=examples/research-writer/research-writer.mmd
```

- `plan` has two arrows with no labels, so `searchWeb` and `searchPapers` run at the same time. `write` waits for both.
- `judge` writes a `score`. The decision sends the draft to `revise` until the score is 8 or more, at most 3 times.
- `approve` is a human step. The run is saved and waits. If the editor rejects it, their `feedback` goes back to `revise`.

## The steps

```ts file=examples/research-writer/tools.ts
```

Each agent's `{field}` placeholders are filled from the shared data. `write` reads what both searches found; `revise` reads `feedback`, from the judge or from the editor. Every answer must match its `output` schema.

## Run it with a real model

```bash
npm install typemaid ai @ai-sdk/anthropic
```

```ts file=examples/research-writer/index.ts
```

Any AI SDK model works: OpenAI, Gemini, a local model through Ollama, or LiteLLM. See [Models](/docs/models/#providers).

## Approve or send it back

The first `run()` returns `paused` with the editor's options:

```json
{ "status": "paused", "waitingAt": [{ "node": "approve", "label": "Editor approval", "options": ["approved", "rejected"] }] }
```

Approve it, or send it back with notes:

```ts
await resume(runId, tools, { decision: 'approved' }, { model, store });
await resume(runId, tools, { decision: 'rejected', feedback: 'Shorter intro, please.' }, { model, store });
```

## Test it without a model

Answer each agent yourself with `runAgent`. `request.node` says which step is asking:

```ts
const result = await run('./research-writer.mmd', tools, { topic: 'typed AI workflows' }, {
  store,
  runAgent: async ({ node }) => {
    if (node === 'plan') return { title: 'Typed AI workflows', sections: ['Why', 'How', 'Next'], query: 'typed AI workflows' };
    if (node === 'judge') return { score: 9, feedback: 'Good.' };
    return { draft: 'A draft.' };
  },
});
// { status: 'paused', waitingAt: [{ node: 'approve', … }] }
```

See [Testing workflows](/docs/guides/testing/).
