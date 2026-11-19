import { z } from 'zod';
import { agent, human, tool } from 'typemaid';

export const add = tool({
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ sum: z.number() }),
  run: ({ a, b }) => ({ sum: a + b }),
});
export const double = tool({
  input: z.object({ sum: z.number() }),
  output: z.object({ sum: z.number() }),
  run: ({ sum }) => ({ sum: sum * 2 }),
});
export const negate = tool({
  input: z.object({ sum: z.number() }),
  output: z.object({ sum: z.number() }),
  run: ({ sum }) => ({ sum: -sum }),
});
export const left = tool({
  input: z.object({ sum: z.number() }),
  output: z.object({ l: z.number() }),
  run: ({ sum }) => ({ l: sum + 1 }),
});
export const right = tool({
  input: z.object({ sum: z.number() }),
  output: z.object({ r: z.number() }),
  run: ({ sum }) => ({ r: sum + 2 }),
});
export const merge = tool({
  input: z.object({ l: z.number(), r: z.number() }),
  output: z.object({ merged: z.number() }),
  run: ({ l, r }) => ({ merged: l * r }),
});
export const route = tool({
  input: z.object({ sum: z.number() }),
  output: z.object({ decision: z.enum(['small', 'large']) }),
  run: ({ sum }) => ({ decision: sum < 10 ? ('small' as const) : ('large' as const) }),
});
export const listNumbers = tool({
  output: z.object({ numbers: z.array(z.number()) }),
  run: () => ({ numbers: [1, 2, 3, 4] }),
});
export const square = tool({
  input: z.object({ item: z.number() }),
  output: z.object({ squared: z.number() }),
  run: ({ item }) => ({ squared: item * item }),
});
export const total = tool({
  input: z.object({ each: z.array(z.object({ squared: z.number() })) }),
  output: z.object({ total: z.number() }),
  run: ({ each }) => ({ total: each.reduce((n, e) => n + e.squared, 0) }),
});

// For nested-loops.mmd
export const goal = tool({
  input: z.object({ goal: z.string() }),
  run: () => undefined,
});
export const plan = agent({
  prompt: 'Plan tasks for: {goal}',
  output: z.object({ tasks: z.array(z.string()) }),
});
export const task = agent({
  prompt: 'Do the next task of: {tasks}',
  output: z.object({ tasks: z.array(z.string()), result: z.string() }),
});
export const verify = agent({
  prompt: 'Check: {result}',
  output: z.object({ passes: z.boolean() }),
});
export const moreTasks = (ctx: Readonly<Record<string, unknown>>) => (ctx.tasks as string[]).length > 0;
export const approve = human({ resume: z.object({ comment: z.string().optional() }) });
