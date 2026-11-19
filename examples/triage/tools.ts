import { z } from 'zod';
import { human, tool } from 'typemaid';

export const fetchTicket = tool({
  input: z.object({ ticketId: z.string() }),
  output: z.object({ body: z.string() }),
  run: ({ ticketId }) => ({
    body: ticketId === 'T-URGENT' ? 'Production is down, please help!' : 'How do I change my avatar?',
  }),
});

export const classify = tool({
  input: z.object({ body: z.string() }),
  output: z.object({ priority: z.number() }),
  run: ({ body }) => ({ priority: /down|urgent|outage/i.test(body) ? 5 : 2 }),
});

export const approve = human({
  resume: z.object({ note: z.string().optional() }),
});

export const reply = tool({
  input: z.object({ body: z.string(), note: z.string().optional() }),
  output: z.object({ draft: z.string() }),
  run: ({ body, note }) => ({ draft: `Re: ${body}${note ? ` (${note})` : ''}` }),
});

export const send = tool({
  input: z.object({ draft: z.string() }),
  output: z.object({ sent: z.boolean() }),
  // ctx.key is the same if this step is ever re-run, so a real mail API can drop duplicates.
  run: (_input, ctx) => ({ sent: ctx.key.length > 0 }),
});

export const closeTicket = tool({
  input: z.object({ ticketId: z.string() }),
  output: z.object({ closed: z.boolean() }),
  run: () => ({ closed: true }),
});
