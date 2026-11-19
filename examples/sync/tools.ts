import { z } from 'zod';
import { tool } from 'typemaid';

const PAGES = [[1, 2], [3, 4], [5]];

export const fetch = tool({
  input: z.object({ page: z.number().optional() }),
  output: z.object({ page: z.number(), items: z.array(z.number()) }),
  run: ({ page = 0 }) => ({ page: page + 1, items: PAGES[page] ?? [] }),
});

export const process = tool({
  input: z.object({ items: z.array(z.number()), total: z.number().optional(), page: z.number().optional() }),
  output: z.object({ total: z.number(), more: z.boolean() }),
  run: ({ items, total = 0, page }) => ({
    total: total + items.reduce((a, b) => a + b, 0),
    more: page !== undefined && page < PAGES.length,
  }),
});
