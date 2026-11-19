import { z } from 'zod';
import { agent, tool } from 'typemaid';

export const fetchPage = tool({
  input: z.object({ topic: z.string() }),
  output: z.object({ text: z.string() }),
  run: ({ topic }) => ({
    text: `${topic} are diagrams written as text. They live next to code, are easy to review in pull requests, and render in many tools. Teams use them for flows, sequences and architecture sketches.`,
  }),
});

export const summarize = agent({
  instructions: 'You write short, factual summaries.',
  prompt: 'Summarize this text as at least three short bullet points:\n\n{text}',
  output: z.object({ bullets: z.array(z.string()) }),
});
