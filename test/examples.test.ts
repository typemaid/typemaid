import { describe, expect, it } from 'bun:test';
import { memoryStore, resume, run } from 'typemaid';
import * as hello from '../examples/hello/tools.ts';
import * as reviewLoop from '../examples/review-loop/tools.ts';
import * as sync from '../examples/sync/tools.ts';
import * as triage from '../examples/triage/tools.ts';
import * as emails from '../examples/emails/tools.ts';
import * as summarize from '../examples/summarize/tools.ts';

const flow = (name: string) => new URL(`../examples/${name}/${name}.mmd`, import.meta.url);

describe('examples', () => {
  it('hello: runs a sequence', async () => {
    const result = await run(flow('hello'), hello, { name: 'Ada' });
    expect(result).toMatchObject({ status: 'completed', output: { name: 'Ada', greeting: 'Hello, Ada', loud: 'HELLO, ADA!' } });
  });

  it('review-loop: loops until the condition holds', async () => {
    const result = await run(flow('review-loop'), reviewLoop, { topic: 'Pricing' });
    expect(result).toMatchObject({ status: 'completed', output: { version: 3, score: 9, published: true } });
  });

  it('sync: default entry loops over pages', async () => {
    const result = await run(flow('sync'), sync);
    expect(result).toMatchObject({ status: 'completed', output: { page: 3, total: 15, more: false } });
  });

  it('sync: second entry point takes its own input', async () => {
    const result = await run(flow('sync'), sync, { items: [10, 20] }, { start: 'webhook' });
    expect(result).toMatchObject({ status: 'completed', output: { total: 30, more: false } });
  });

  it('triage: low priority goes straight through', async () => {
    const result = await run(flow('triage'), triage, { ticketId: 'T-1' });
    expect(result).toMatchObject({ status: 'completed', output: { priority: 2, sent: true } });
  });

  it('triage: urgent pauses for approval, then continues', async () => {
    const store = memoryStore();
    const paused = await run(flow('triage'), triage, { ticketId: 'T-URGENT' }, { store });
    expect(paused.status).toBe('paused');
    if (paused.status !== 'paused') return;
    expect(paused.waitingAt).toEqual([
      { node: 'approve', label: 'Manager approval', fields: { note: { kind: 'string', required: false } }, options: ['approved', 'rejected'] },
    ]);
    await expect(resume(paused.runId, triage, { decision: 'maybe' }, { store })).rejects.toThrow(/one of: approved, rejected/);
    const done = await resume(paused.runId, triage, { decision: 'approved', note: 'go ahead' }, { store });
    expect(done).toMatchObject({ status: 'completed', output: { decision: 'approved', draft: 'Re: Production is down, please help! (go ahead)', sent: true } });
  });

  it('triage: rejection takes the other arrow', async () => {
    const store = memoryStore();
    const paused = await run(flow('triage'), triage, { ticketId: 'T-URGENT' }, { store });
    const done = await resume(paused.runId, triage, { decision: 'rejected' }, { store });
    expect(done).toMatchObject({ status: 'completed', output: { closed: true } });
    expect(done.status === 'completed' && 'sent' in done.output).toBe(false);
  });

  it('emails: for-each keeps input order and collects per-item results', async () => {
    const result = await run(flow('emails'), emails);
    expect(result).toMatchObject({
      status: 'completed',
      output: {
        each: [
          { isSpam: false, action: 'replied', draft: 'Thanks for "Invoice question"' },
          { isSpam: true, action: 'archived' },
          { isSpam: false, action: 'replied', draft: 'Thanks for "Meeting notes"' },
        ],
        summary: '2 replied, 1 archived',
      },
    });
  });

  it('summarize: agent step with a fake model, repaired after a bad answer', async () => {
    const prompts: string[] = [];
    const answers: unknown[] = [{ bullets: 'not a list' }, { bullets: ['a', 'b'] }, { bullets: ['a', 'b', 'c'] }];
    const result = await run(flow('summarize'), summarize, { topic: 'Mermaid flowcharts' }, {
      runAgent: async (request) => {
        prompts.push(request.prompt);
        return answers.shift();
      },
    });
    expect(result).toMatchObject({ status: 'completed', output: { bullets: ['a', 'b', 'c'] } });
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain('Mermaid flowcharts are diagrams written as text');
    expect(prompts[1]).toContain('Your previous answer was not valid');
  });
});
