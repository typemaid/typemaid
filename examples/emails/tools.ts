import { z } from 'zod';
import { tool } from 'typemaid';

const Email = z.object({ from: z.string(), subject: z.string() });

export const fetchEmails = tool({
  output: z.object({ emails: z.array(Email) }),
  run: () => ({
    emails: [
      { from: 'ana@example.com', subject: 'Invoice question' },
      { from: 'win@prizes.example', subject: 'YOU WON!!!' },
      { from: 'li@example.com', subject: 'Meeting notes' },
    ],
  }),
});

export const classify = tool({
  input: z.object({ email: Email }),
  output: z.object({ isSpam: z.boolean() }),
  run: ({ email }) => ({ isSpam: /won|prize/i.test(email.subject) }),
});

export const archive = tool({
  input: z.object({ email: Email }),
  output: z.object({ action: z.string() }),
  run: () => ({ action: 'archived' }),
});

export const reply = tool({
  input: z.object({ email: Email }),
  output: z.object({ action: z.string(), draft: z.string() }),
  run: ({ email }) => ({ action: 'replied', draft: `Thanks for "${email.subject}"` }),
});

export const report = tool({
  input: z.object({ each: z.array(z.object({ action: z.string() })) }),
  output: z.object({ summary: z.string() }),
  run: ({ each }) => ({
    summary: `${each.filter((e) => e.action === 'replied').length} replied, ${each.filter((e) => e.action === 'archived').length} archived`,
  }),
});
