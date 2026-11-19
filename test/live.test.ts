/**
 * Talks to a real model. Skipped unless the TYPEMAID_TEST_* variables are set.
 * Run with: bun run test:live
 */
import { describe, expect, it } from 'bun:test';
import { run } from 'typemaid';
import * as tools from '../examples/summarize/tools.ts';

const apiKey = process.env.TYPEMAID_TEST_API_KEY;
const baseURL = process.env.TYPEMAID_TEST_BASE_URL;
const modelId = process.env.TYPEMAID_TEST_MODEL ?? 'claude-haiku-4-5-20251001';

describe.skipIf(!apiKey || !baseURL)('live model', () => {
  it('an agent step returns output that matches its schema', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const model = createAnthropic({ apiKey: apiKey!, baseURL: baseURL! })(modelId);
    const events: string[] = [];
    const result = await run(
      new URL('../examples/summarize/summarize.mmd', import.meta.url),
      tools,
      { topic: 'Mermaid flowcharts' },
      { model, onEvent: (e) => events.push(e.type) },
    );
    expect(result.status, JSON.stringify(result)).toBe('completed');
    if (result.status !== 'completed') return;
    const bullets = result.output.bullets as string[];
    expect(Array.isArray(bullets)).toBe(true);
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    for (const b of bullets) expect(typeof b).toBe('string');
    console.log('model answered:', bullets);
  }, 120_000);

  it('a tool can call the model directly, as text and as a checked object', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { z } = await import('zod');
    const { tool } = await import('typemaid');
    const { defineAI } = await import('typemaid/ai');
    const ai = defineAI({ model: createAnthropic({ apiKey: apiKey!, baseURL: baseURL! })(modelId) });
    const tools = {
      classify: tool({
        input: z.object({ review: z.string() }),
        output: z.object({ sentiment: z.enum(['positive', 'negative']), reply: z.string() }),
        run: async ({ review }, ctx) => {
          const { sentiment } = await ai.ask(ctx, { prompt: `Is this review positive or negative? "${review}"`, output: z.object({ sentiment: z.enum(['positive', 'negative']) }) });
          const reply = await ai.text(ctx, { prompt: `Write one short sentence replying to this ${sentiment} review: "${review}"` });
          return { sentiment, reply };
        },
      }),
    };
    const result = await run('flowchart TD\n  classify', tools, { review: 'Terrible. It broke on the first day.' });
    expect(result.status, JSON.stringify(result)).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.output.sentiment).toBe('negative');
    expect(String(result.output.reply).length).toBeGreaterThan(5);
    console.log('model replied:', result.output.reply);
  }, 120_000);

  it('an agent can use a tool before answering', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { tool: aiTool } = await import('ai');
    const { z } = await import('zod');
    const { defineAI } = await import('typemaid/ai');
    const ai = defineAI({ model: createAnthropic({ apiKey: apiKey!, baseURL: baseURL! })(modelId) });
    let called = 0;
    const stock = aiTool({ description: 'Look up how many units of a product are in stock.', inputSchema: z.object({ product: z.string() }), execute: async () => (called++, { units: 42 }) });
    const tools = { check: ai.agent({ prompt: 'How many units of {product} are in stock? Use the tool.', tools: { stock }, maxSteps: 4, output: z.object({ units: z.number() }) }) };
    const result = await run('flowchart TD\n  check', tools, { product: 'blue widget' });
    expect(result.status, JSON.stringify(result)).toBe('completed');
    expect(called).toBeGreaterThanOrEqual(1);
    expect(result.status === 'completed' && result.output.units).toBe(42);
  }, 120_000);
});
