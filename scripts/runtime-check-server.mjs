// The server-only half of runtime-check.mjs: files, SQLite and the viewer.
import { human, resume, run, tool } from '../dist/index.mjs';

export default async function serverChecks(assert) {
  const extras = [];
  const fromFile = await run(new URL('../examples/hello/hello.mmd', import.meta.url), { greet: tool({ run: () => ({ greeting: 'hi' }) }), shout: tool({ run: () => ({}) }) });
  assert(fromFile.status === 'completed', 'run from a file');
  extras.push('files');
  try {
    const { sqliteStore } = await import('../dist/sqlite.mjs');
    const db = sqliteStore(':memory:');
    const p = await run('flowchart TD\n  ask', { ask: human() }, {}, { store: db });
    assert((await resume(p.runId, { ask: human() }, {}, { store: db })).status === 'completed', 'sqlite resume');
    db.close();
    extras.push('sqlite');
  } catch (err) {
    extras.push(`sqlite unavailable (${String(err.message).split('\n')[0]})`);
  }
  const { view } = await import('../packages/view/dist/index.mjs');
  const viewer = await view(new URL('../examples', import.meta.url).pathname, { port: 48200 + Math.floor(Math.random() * 500), watch: false, tools: false });
  const flows = await (await fetch(`${viewer.url}api/v1/flows`)).json();
  await viewer.close();
  assert(flows.flows.length === 6, 'viewer');
  extras.push('viewer');
  return extras;
}
