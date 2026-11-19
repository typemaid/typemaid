# Models

## Which provider packages?

Use the Vercel AI SDK's own provider packages. typemaid does not ship providers and does not need to: `typemaid/ai` is a thin wrapper that accepts any AI SDK model.

```bash
npm install ai @ai-sdk/openai
```

```ts
import { openai } from '@ai-sdk/openai';
import { defineAI } from 'typemaid/ai';

export const ai = defineAI({ model: openai('gpt-5-mini') });
```

To switch provider, install another package (`@ai-sdk/anthropic`, `@ai-sdk/google`, ...) and change that one line. New models work as soon as the provider package supports them, with no typemaid release.

`ai` is an optional peer dependency. Workflows that never call a model do not need it, and it is only loaded when the first model call runs.

## An agent step

A step whose work is one model call with a typed answer:

```ts
export const summarize = ai.agent({
  prompt: 'Summarize in three bullets: {text}',
  output: z.object({ bullets: z.array(z.string()) }),
});
```

`{text}` is filled from the shared data. The checker reports a placeholder nothing wrote.

## A model call inside a tool

```ts
export const reply = tool({
  input: z.object({ review: z.string() }),
  output: z.object({ reply: z.string() }),
  run: async ({ review }, ctx) => {
    const { sentiment } = await ai.ask(ctx, {
      prompt: `Is this review positive or negative? "${review}"`,
      output: z.object({ sentiment: z.enum(['positive', 'negative']) }),
    });
    return { reply: await ai.text(ctx, { prompt: `Reply to this ${sentiment} review: "${review}"` }) };
  },
});
```

Passing `ctx` ties the call to the step: it is cancelled when the step times out or the run is cancelled.

## The model never picks the next step

The diagram decides the order. A model can write a field (`score`, `isSpam`) and a decision node can branch on it, but the path is always one drawn in the diagram.

## Testing without a model

Replace the model call with your own function:

```ts
await run(flow, tools, input, {
  runAgent: async (request) => ({ bullets: ['a', 'b', 'c'] }),
});
```

## Other ways to call a model

A tool is ordinary code. You can call any SDK or HTTP API directly inside `run`; you only lose the schema check and the automatic cancelling that `ai.ask` gives.
