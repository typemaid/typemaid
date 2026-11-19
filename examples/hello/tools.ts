import { z } from 'zod';
import { tool } from 'typemaid';

export const greet = tool({
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  run: ({ name }) => ({ greeting: `Hello, ${name}` }),
});

export const shout = tool({
  input: z.object({ greeting: z.string() }),
  output: z.object({ loud: z.string() }),
  run: ({ greeting }) => ({ loud: `${greeting.toUpperCase()}!` }),
});
