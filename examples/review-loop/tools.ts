import { z } from 'zod';
import { tool } from 'typemaid';

// Each pass produces a longer draft; the score rises with it. No model needed.
export const draft = tool({
  input: z.object({ topic: z.string(), version: z.number().optional() }),
  output: z.object({ version: z.number(), text: z.string() }),
  run: ({ topic, version = 0 }) => ({ version: version + 1, text: `${topic}: draft ${version + 1}` }),
});

export const review = tool({
  input: z.object({ version: z.number() }),
  output: z.object({ score: z.number() }),
  run: ({ version }) => ({ score: version * 3 }),
});

export const publish = tool({
  input: z.object({ text: z.string() }),
  output: z.object({ published: z.boolean() }),
  run: () => ({ published: true }),
});
