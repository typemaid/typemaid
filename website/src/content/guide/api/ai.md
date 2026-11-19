Choose a model once and use it for every model call. From `typemaid/ai`.

```ts
import { defineAI } from 'typemaid/ai';

function defineAI(options: {
  model: unknown;          // an AI SDK model, e.g. openai('gpt-5-mini')
  instructions?: string;   // guidance added to every call that does not set its own
}): AI;
```

Needs the AI SDK and a provider:

```bash
npm install ai @ai-sdk/openai
```

The AI SDK is loaded only when a model call runs, so flows without model calls do not need it installed.

## ai.agent(spec)

An agent step with the model filled in. Takes the same spec as [`agent()`](/docs/api/steps/#agent).

```ts
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { defineAI } from 'typemaid/ai';

export const ai = defineAI({ model: openai('gpt-5-mini') });

export const summarize = ai.agent({
  instructions: 'You write short, factual summaries.',
  prompt: 'Summarize as bullet points:\n\n{text}',
  output: z.object({ bullets: z.array(z.string()) }),
});
```

## ai.ask(ctx, request)

Inside a tool: ask for a structured answer. Pass the tool's `ctx` so the call is cancelled with the step.

```ts
const { sentiment } = await ai.ask(ctx, {
  prompt: `Is this review positive or negative? "${review}"`,
  output: z.object({ sentiment: z.enum(['positive', 'negative']) }),
});
```

## ai.text(ctx, request)

Inside a tool: ask for plain text.

```ts
const reply = await ai.text(ctx, { prompt: `Reply in one sentence to: "${review}"` });
```

## Agents with tools

An agent can call AI SDK tools while it works out its answer. `maxSteps` is required.

```ts
import { tool as aiTool } from 'ai';

const stock = aiTool({
  description: 'Look up how many units are in stock.',
  inputSchema: z.object({ product: z.string() }),
  execute: async ({ product }) => inventory.count(product),
});

export const check = ai.agent({
  prompt: 'How many units of {product} are in stock?',
  tools: { stock },
  maxSteps: 4,
  output: z.object({ units: z.number() }),
});
```

More in [Models](/docs/models/).
