// Calls a real model. Run with: ANTHROPIC_API_KEY=... bun examples/summarize/index.ts
// Any AI SDK provider works the same way: swap the import and the model.
import { anthropic } from '@ai-sdk/anthropic';
import { run } from 'typemaid';
import * as tools from './tools.ts';

const result = await run(
  new URL('./summarize.mmd', import.meta.url),
  tools,
  { topic: 'Mermaid flowcharts' },
  { model: anthropic('claude-haiku-4-5') },
);
console.log(JSON.stringify(result, null, 2));
