Fetch some text and have a model summarize it into bullet points, asking again until there are at least three. It shows an agent step, a loop over a model answer, and testing with a fake model.

## The diagram

```mermaid file=examples/summarize/summarize.mmd
```

## The steps

```ts file=examples/summarize/tools.ts
```

`{text}` in the prompt is filled in from the `text` field that `fetchPage` writes. The answer must match `output`; if it does not, the model is asked once more and told what was wrong.

## Run it with a real model

Install the AI SDK and a provider, and pass the model to `run()`:

```bash
npm install ai @ai-sdk/openai
```

```ts
import { openai } from '@ai-sdk/openai';
import { run } from 'typemaid';
import * as tools from './tools.ts';

const result = await run('./summarize.mmd', tools, { topic: 'Mermaid flowcharts' }, {
  model: openai('gpt-5-mini'),
});
```

To set the model once for every agent instead, use [`defineAI()`](/docs/api/ai/).

## Run it with a fake model

In tests, answer agent steps yourself with `runAgent`:

```ts
const result = await run('./summarize.mmd', tools, { topic: 'Mermaid flowcharts' }, {
  runAgent: async () => ({ bullets: ['a', 'b', 'c'] }),
});
// { status: 'completed', output: { topic: '…', text: '…', bullets: ['a', 'b', 'c'] } }
```

See [Testing workflows](/docs/guides/testing/).
