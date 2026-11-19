// Calls a real model. Run with: ANTHROPIC_API_KEY=... bun examples/research-writer/index.ts
// Any AI SDK provider works the same way: swap the import and the model.
import { anthropic } from '@ai-sdk/anthropic';
import { memoryStore, resume, run } from 'typemaid';
import * as tools from './tools.ts';

const model = anthropic('claude-haiku-4-5');
const store = memoryStore();

// Plans, searches, writes and scores until the judge is happy, then waits for the editor.
const paused = await run(new URL('./research-writer.mmd', import.meta.url), tools, { topic: 'typed AI workflows' }, { model, store });
console.log(JSON.stringify(paused, null, 2));

// The editor approves. In a real app this happens later, from another request.
if (paused.status === 'paused') {
  const done = await resume(paused.runId, tools, { decision: 'approved' }, { model, store });
  console.log(JSON.stringify(done, null, 2));
}
