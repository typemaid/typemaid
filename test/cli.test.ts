import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { root } from './files.ts';

const exec = promisify(execFile);
const cli = path.join(root, 'dist/cli.mjs');
const dir = mkdtempSync(path.join(tmpdir(), 'flow-cli-'));

async function flow(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, ...args], { cwd: root });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

beforeAll(() => {
  execFileSync('bun', ['run', 'build'], { cwd: root, stdio: 'pipe' });
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('command line (built package, separate processes)', () => {
  it('check: passes on the examples and finds their tools', async () => {
    const out = await flow('check', 'examples');
    expect(out.code).toBe(0);
    expect(out.stdout).toContain('ok    examples/hello/hello.mmd  (with examples/hello/tools.ts)');
    expect(out.stdout).toMatch(/6 files checked: 0 errors, 1 warning\./);
  });

  it('check: reports problems with file, line and fix, and exits 1', async () => {
    const file = path.join(dir, 'broken.mmd');
    writeFileSync(file, 'flowchart TD\n  a --> call\n  b-->c\n');
    const out = await flow('check', file);
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('error E1003');
    expect(out.stdout).toContain('error E1004');
    expect(out.stdout).toContain('fix: ');
  });

  it('check --json prints machine-readable diagnostics', async () => {
    const file = path.join(dir, 'broken2.mmd');
    writeFileSync(file, 'flowchart TD\n  a --- b\n');
    const out = await flow('check', file, '--json');
    const list = JSON.parse(out.stdout) as Array<{ code: string; line: number; column: number; severity: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: 'E1005', line: 2, column: 5, severity: 'error' });
  });

  it('check: a diagram whose tool is missing fails with a suggestion', async () => {
    const sub = path.join(dir, 'proj');
    execFileSync('mkdir', ['-p', sub]);
    writeFileSync(path.join(sub, 'flow.mmd'), 'flowchart TD\n  greet --> shuot\n');
    writeFileSync(path.join(sub, 'tools.mjs'), `import { tool } from ${JSON.stringify(path.join(root, 'dist/index.mjs'))};\nexport const greet = tool({ run: () => ({}) });\nexport const shout = tool({ run: () => ({}) });\n`);
    const out = await flow('check', sub);
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('Did you mean `shout`?');
  });

  it('run: prints the result as JSON', async () => {
    const out = await flow('run', 'examples/hello/hello.mmd', '--input', '{"name":"Ada"}');
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toMatchObject({ status: 'completed', output: { loud: 'HELLO, ADA!' } });
    expect(out.stderr).toContain('done    greet');
  });

  it('run: a missing input is explained and exits 1', async () => {
    const out = await flow('run', 'examples/hello/hello.mmd');
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('run() is missing input: name');
  });

  it('run then resume in a second process, with the SQLite store', async () => {
    const db = path.join(dir, 'runs.db');
    const first = await flow('run', 'examples/triage/triage.mmd', '--input', '{"ticketId":"T-URGENT"}', '--store', db);
    expect(first.code).toBe(0);
    const paused = JSON.parse(first.stdout) as { status: string; runId: string };
    expect(paused.status).toBe('paused');

    const bad = await flow('resume', paused.runId, '--store', db, '--tools', 'examples/triage/tools.ts', '--answer', '{"decision":"perhaps"}');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('one of: approved, rejected');

    const second = await flow('resume', paused.runId, '--store', db, '--tools', 'examples/triage/tools.ts', '--answer', '{"decision":"approved","note":"ok"}');
    expect(second.code).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ status: 'completed', output: { sent: true, decision: 'approved' } });
  });

  it('an unknown option is refused instead of being ignored', async () => {
    const out = await flow('run', 'examples/hello/hello.mmd', '--inptu', '{"name":"Ada"}');
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('Unknown option --inptu');
    expect((await flow('run', 'examples/hello/hello.mmd', '{"name":"Ada"}')).stderr).toContain('Pass input with --input');
  });

  it('a run that pauses without --store says it cannot be continued', async () => {
    const out = await flow('run', 'examples/triage/triage.mmd', '--input', '{"ticketId":"T-URGENT"}');
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('was not saved and cannot be continued');
  });

  it('prints help for unknown commands', async () => {
    expect((await flow('help')).stdout).toContain('Usage:');
    expect((await flow('nonsense')).code).toBe(1);
  });
});
