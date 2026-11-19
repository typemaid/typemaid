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

## Providers

typemaid passes your model straight to the AI SDK, so every AI SDK provider works. Install the provider next to `ai`, import its function, and give it a model name: `import { anthropic } from '@ai-sdk/anthropic'`, then `anthropic('claude-haiku-4-5')`.

| Provider | Package | Function |
|---|---|---|
| OpenAI | `@ai-sdk/openai` | `openai` |
| Anthropic | `@ai-sdk/anthropic` | `anthropic` |
| Google Gemini | `@ai-sdk/google` | `google` |
| Google Vertex AI | `@ai-sdk/google-vertex` | `vertex` |
| Azure OpenAI | `@ai-sdk/azure` | `azure` |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` | `bedrock` |
| Mistral | `@ai-sdk/mistral` | `mistral` |
| xAI Grok | `@ai-sdk/xai` | `xai` |
| Groq | `@ai-sdk/groq` | `groq` |
| DeepSeek | `@ai-sdk/deepseek` | `deepseek` |
| Cohere | `@ai-sdk/cohere` | `cohere` |
| Together AI | `@ai-sdk/togetherai` | `togetherai` |
| Fireworks | `@ai-sdk/fireworks` | `fireworks` |
| Cerebras | `@ai-sdk/cerebras` | `cerebras` |
| Perplexity | `@ai-sdk/perplexity` | `perplexity` |
| DeepInfra | `@ai-sdk/deepinfra` | `deepinfra` |
| OpenRouter (community) | `@openrouter/ai-sdk-provider` | `openrouter` |
| Ollama, local models (community) | `ollama-ai-provider-v2` | `ollama` |

The full list, including newer providers, is on the [AI SDK providers page](https://ai-sdk.dev/providers/ai-sdk-providers). Each provider reads its API key from an environment variable, for example `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; see its page for the name.

### LiteLLM and other OpenAI-compatible servers

A [LiteLLM](https://docs.litellm.ai) proxy speaks the OpenAI API, so connect to it with `@ai-sdk/openai-compatible`. The same works for any server with an OpenAI-style `/v1/chat/completions` endpoint.

```bash
npm install ai @ai-sdk/openai-compatible
```

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { defineAI } from 'typemaid/ai';

const litellm = createOpenAICompatible({
  name: 'litellm',
  baseURL: 'http://localhost:4000/v1',
  apiKey: process.env.LITELLM_API_KEY,
  supportsStructuredOutputs: true,
});

export const ai = defineAI({ model: litellm('gpt-4o-mini') });
```

Use the model names you set up in LiteLLM. `supportsStructuredOutputs: true` lets agent steps ask for JSON that matches their `output` schema; leave it out if the models behind your proxy do not support that, and typemaid still checks every answer against the schema.

### Model names as text (Vercel AI Gateway)

The AI SDK also accepts a model name as a string, such as `'openai/gpt-5-mini'`. It sends those calls through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), which needs `AI_GATEWAY_API_KEY`:

```ts
export const ai = defineAI({ model: 'openai/gpt-5-mini' });
```

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
