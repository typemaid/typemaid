import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { agent, bind, compile, FlowError, run, tool, type AgentRequest } from 'typemaid';
import { defineAI } from 'typemaid/ai';

/** A stand-in for the model: records what it was asked and answers from a list. */
function fakeModel(answers: unknown[]) {
  const seen: AgentRequest[] = [];
  return { seen, runAgent: async (request: AgentRequest) => (seen.push(request), answers.shift()) };
}

describe('model calls', () => {
  it('defineAI sets the model once for agent steps', async () => {
    const ai = defineAI({ model: 'the-model', instructions: 'Be brief.' });
    const tools = {
      summarize: ai.agent({ prompt: 'Summarize: {text}', output: z.object({ summary: z.string() }) }),
      other: ai.agent({ prompt: 'Again: {summary}', instructions: 'Own rule.', model: 'special', output: z.object({ again: z.string() }) }),
    };
    const fake = fakeModel([{ summary: 'short' }, { again: 'yes' }]);
    const result = await run('flowchart TD\n  summarize --> other', tools, { text: 'long text' }, { runAgent: fake.runAgent });
    expect(result).toMatchObject({ status: 'completed', output: { summary: 'short', again: 'yes' } });
    expect(fake.seen[0]).toMatchObject({ node: 'summarize', model: 'the-model', instructions: 'Be brief.', prompt: 'Summarize: long text' });
    expect(fake.seen[1]).toMatchObject({ node: 'other', model: 'special', instructions: 'Own rule.', prompt: 'Again: short' });
  });

  it('a tool can ask the model for a structured answer, checked against the schema', async () => {
    const ai = defineAI({ model: 'the-model' });
    const tools = {
      grade: tool({
        input: z.object({ essay: z.string() }),
        output: z.object({ score: z.number(), passed: z.boolean() }),
        run: async ({ essay }, ctx) => {
          const { score } = await ai.ask(ctx, { prompt: `Grade this from 1 to 10: ${essay}`, output: z.object({ score: z.number().min(1).max(10) }) });
          return { score, passed: score >= 6 };
        },
      }),
    };
    const fake = fakeModel([{ score: 99 }, { score: 7 }]);
    const result = await run('flowchart TD\n  grade', tools, { essay: 'My essay' }, { runAgent: fake.runAgent });
    expect(result).toMatchObject({ status: 'completed', output: { score: 7, passed: true } });
    expect(fake.seen).toHaveLength(2);
    expect(fake.seen[0]!.prompt).toBe('Grade this from 1 to 10: My essay');
    expect(fake.seen[1]!.prompt).toContain('Your previous answer was not valid');
    expect(fake.seen[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('a tool can ask for plain text, and ctx.ask works without defineAI using the run() model', async () => {
    const tools = {
      write: tool({
        output: z.object({ haiku: z.string(), mood: z.string() }),
        run: async (_input, ctx) => {
          const haiku = await ctx.text({ prompt: 'Write a haiku' });
          const { mood } = await ctx.ask({ prompt: `Mood of: ${haiku}`, output: z.object({ mood: z.string() }) });
          return { haiku, mood };
        },
      }),
    };
    const fake = fakeModel(['old pond', { mood: 'calm' }]);
    const result = await run('flowchart TD\n  write', tools, {}, { runAgent: fake.runAgent, model: 'run-model' });
    expect(result).toMatchObject({ status: 'completed', output: { haiku: 'old pond', mood: 'calm' } });
    expect(fake.seen.map((r) => [r.model, r.schema === undefined])).toEqual([['run-model', true], ['run-model', false]]);
  });

  it('an answer that stays wrong fails the step with the reason', async () => {
    const tools = { t: tool({ run: async (_i, ctx) => void (await ctx.ask({ prompt: 'x', output: z.object({ n: z.number() }) })) }) };
    const result = await run('flowchart TD\n  t', tools, {}, { runAgent: fakeModel([{ n: 'a' }, { n: 'b' }]).runAgent });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'E1323', node: 't' } });
  });

  it('a slow model call inside a tool is stopped by the step timeout', async () => {
    let aborted = false;
    const tools = { t: tool({ timeoutMs: 30, run: async (_i, ctx) => void (await ctx.text({ prompt: 'x' })) }) };
    const runAgent = (request: AgentRequest) => new Promise<string>((resolve) => request.signal.addEventListener('abort', () => { aborted = true; resolve('late'); }));
    expect(await run('flowchart TD\n  t', tools, {}, { runAgent })).toMatchObject({ status: 'failed', error: { code: 'E1324' } });
    expect(aborted).toBe(true);
  });

  it('with no model set, the error says how to set one', async () => {
    const tools = { a: agent({ prompt: 'hi', output: z.object({ x: z.string() }) }) };
    const result = await run('flowchart TD\n  a', tools);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error.message).toContain('defineAI({ model })');
  });

  it('an agent may use AI SDK tools, but only with a limit on turns', async () => {
    const search = { description: 'search', inputSchema: z.object({ q: z.string() }), execute: async () => 'result' };
    const noLimit = { a: agent({ prompt: 'hi', tools: { search }, output: z.object({ x: z.string() }) }) };
    expect(() => bind(compile('flowchart TD\n  a'), noLimit)).toThrow(FlowError);
    expect(() => bind(compile('flowchart TD\n  a'), noLimit)).toThrow(/needs `maxSteps`/);
    const limited = { a: agent({ prompt: 'hi', tools: { search }, maxSteps: 4, output: z.object({ x: z.string() }) }) };
    const fake = fakeModel([{ x: 'ok' }]);
    expect(await run('flowchart TD\n  a', limited, {}, { runAgent: fake.runAgent })).toMatchObject({ status: 'completed', output: { x: 'ok' } });
    expect(fake.seen[0]).toMatchObject({ maxSteps: 4, tools: { search } });
  });
});
