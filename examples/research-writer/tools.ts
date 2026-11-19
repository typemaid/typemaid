import { z } from 'zod';
import { agent, human, tool } from 'typemaid';

// An AI agent plans the post and picks what to search for.
export const plan = agent({
  instructions: 'You plan short, practical technical blog posts.',
  prompt: 'Plan a blog post about: {topic}. Give a title, three section headings and one search query.',
  output: z.object({ title: z.string(), sections: z.array(z.string()), query: z.string() }),
});

// The two searches run at the same time. Replace the bodies with your search APIs.
export const searchWeb = tool({
  input: z.object({ query: z.string() }),
  output: z.object({ webNotes: z.array(z.string()) }),
  run: ({ query }) => ({ webNotes: [`Blog posts about ${query} favour short, runnable examples.`] }),
});

export const searchPapers = tool({
  input: z.object({ query: z.string() }),
  output: z.object({ paperNotes: z.array(z.string()) }),
  run: ({ query }) => ({ paperNotes: [`Studies on ${query} report fewer errors when workflows are typed.`] }),
});

// Another agent writes the first draft from the plan and the research.
export const write = agent({
  instructions: 'You write clear technical blog posts.',
  prompt: 'Write the post "{title}" with these sections: {sections}.\n\nResearch:\n{webNotes}\n{paperNotes}',
  output: z.object({ draft: z.string() }),
});

// A third agent revises the draft, using the judge's feedback or the editor's.
export const revise = agent({
  instructions: 'You improve drafts. Keep what works; fix what the feedback asks for.',
  prompt: 'Revise this draft.\n\nFeedback:\n{feedback}\n\nDraft:\n{draft}',
  output: z.object({ draft: z.string() }),
});

// An AI judge scores the draft. The diagram sends it to `revise` until the score is 8 or more.
export const judge = agent({
  instructions: 'You are a strict editor. Score drafts from 1 to 10.',
  prompt: 'Score this draft and say what to improve:\n\n{draft}',
  output: z.object({ score: z.number(), feedback: z.string() }),
});

// A person approves before anything is published. The run is saved and waits.
// To reject, the editor answers with `decision: 'rejected'` and says what to change in `feedback`.
export const approve = human({
  resume: z.object({ feedback: z.string().optional() }),
});

export const publish = tool({
  input: z.object({ title: z.string(), draft: z.string() }),
  output: z.object({ url: z.string() }),
  // ctx.key is the same if this step is ever re-run, so a real CMS can drop duplicates.
  run: ({ title }, ctx) => ({ url: `https://blog.example.com/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}?id=${ctx.key.length}` }),
});
