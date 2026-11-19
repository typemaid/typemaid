import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { view, VIEW_SCHEMA_VERSION, type FlowList, type FlowView, type Meta, type ViewerEvent } from '@typemaid/view';
import { BRAND, VERSION } from 'typemaid';
import { createViewerHandler, type UiFile } from '../src/handler.ts';
import { fileSource } from '../src/source-fs.ts';
import { root } from '../../../test/files.ts';

const examples = path.join(root, 'examples');
const dir = mkdtempSync(path.join(tmpdir(), 'flow-view-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const ui = new Map<string, UiFile>([
  ['/index.html', { body: new TextEncoder().encode('<!doctype html><title>ui</title>'), type: 'text/html; charset=utf-8', hashed: false }],
  ['/app-0a1b2c3d4e.js', { body: new TextEncoder().encode('//js'), type: 'text/javascript; charset=utf-8', hashed: true }],
]);
const get = (handler: (r: Request) => Promise<Response>, url: string, init?: RequestInit) => handler(new Request(`http://localhost:4747${url}`, init));
const until = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};
function project(name: string, files: Record<string, string>): string {
  const folder = path.join(dir, name);
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(folder, file);
    Bun.spawnSync(['mkdir', '-p', path.dirname(full)]);
    writeFileSync(full, text);
  }
  return folder;
}
const toolsModule = (body: string) => `import { z } from ${JSON.stringify(path.join(root, 'node_modules/zod/index.js'))};\nimport { tool, human } from ${JSON.stringify(path.join(root, 'src/index.ts'))};\n${body}\n`;

describe('viewer data (the contract)', () => {
  it('describes every example workflow', async () => {
    const source = await fileSource({ paths: [examples], watch: false });
    const list = await source.listFlows();
    expect(list.flows.map((f) => f.file)).toEqual(['emails/emails.mmd', 'hello/hello.mmd', 'review-loop/review-loop.mmd', 'summarize/summarize.mmd', 'sync/sync.mmd', 'triage/triage.mmd']);
    expect(list.flows.map((f) => f.title)).toEqual(['Emails', 'Hello', 'Review loop', 'Summarize', 'Sync', 'Triage']);
    for (const f of list.flows) {
      expect(f.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(f.errors).toBe(0);
    }
    const meta = await source.meta();
    expect(meta).toMatchObject({ schemaVersion: VIEW_SCHEMA_VERSION, mode: 'live', rootName: 'examples', generator: { version: VERSION }, capabilities: { runs: false, actions: false } });
    await source.close?.();
  });

  it('gives each step its kind, fields and arrows', async () => {
    const source = await fileSource({ paths: [path.join(examples, 'triage/triage.mmd')], watch: false });
    const flow = (await source.getFlow(source.single()!))!;
    const node = (id: string) => flow.graph!.nodes.find((n) => n.id === id)!;
    expect(node('approve')).toMatchObject({ kind: 'human', label: 'Manager approval', branching: 'exclusive', writes: { decision: { kind: 'string', required: true }, note: { kind: 'string', required: false } } });
    expect(node('classify')).toMatchObject({ kind: 'tool', reads: { body: { kind: 'string', required: true } }, writes: { priority: { kind: 'number', required: true } } });
    expect(node('urgent')).toMatchObject({ kind: 'decision', condition: 'priority >= 4' });
    expect(node('done').kind).toBe('marker');
    expect(node('fetchTicket').entry).toBe(true);
    expect(flow.inputs).toEqual({ fetchTicket: { ticketId: { kind: 'string', required: true } } });
    expect(flow.graph!.edges.filter((e) => e.from === 'approve').map((e) => e.label).sort()).toEqual(['approved', 'rejected']);
    expect(flow.diagram).toEqual({ source: readFileSync(path.join(examples, 'triage/triage.mmd'), 'utf8'), exact: true });
    expect(flow.counts).toEqual({ nodes: 7, tools: 5, agents: 0, humans: 1, decisions: 1 });
    await source.close?.();
  });

  it('describes for-each blocks and loop limits', async () => {
    const source = await fileSource({ paths: [examples], watch: false });
    const flows = (await source.listFlows()).flows;
    const emails = (await source.getFlow(flows.find((f) => f.title === 'Emails')!.id))!;
    expect(emails.graph!.groups).toEqual([{ id: 'each', kind: 'foreach', entry: 'classify', line: 3, item: 'email', list: 'emails' }]);
    expect(emails.graph!.nodes.find((n) => n.id === 'classify')!.group).toBe('each');
    const loop = (await source.getFlow(flows.find((f) => f.title === 'Review loop')!.id))!;
    expect(loop.graph!.edges.find((e) => e.max !== undefined)).toMatchObject({ from: 'good', to: 'draft', label: 'no', max: 5 });
    await source.close?.();
  });

  it('never puts absolute paths or the home folder in what it sends', async () => {
    const folder = project('leak', { 'a.mmd': 'flowchart TD\n  x --> y\n', 'tools.mjs': 'import "./does-not-exist.mjs";\n' });
    for (const paths of [[examples], [folder]]) {
      const source = await fileSource({ paths, watch: false });
      const everything = [await source.meta(), await source.listFlows(), ...(await Promise.all((await source.listFlows()).flows.map((f) => source.getFlow(f.id))))];
      const text = JSON.stringify(everything);
      expect(text).not.toContain(root);
      expect(text).not.toContain(dir);
      expect(text).not.toContain(homedir());
      await source.close?.();
    }
  });

  it('keeps the picture when the tools do not match the diagram', async () => {
    const folder = project('mismatch', { 'flow.mmd': 'flowchart TD\n  greet --> shuot\n', 'tools.mjs': toolsModule('export const greet = tool({ run: () => ({}) });\nexport const shout = tool({ run: () => ({}) });') });
    const source = await fileSource({ paths: [folder], watch: false });
    const flow = (await source.getFlow((await source.listFlows()).flows[0]!.id))!;
    expect(flow.graph!.nodes.map((n) => n.id)).toEqual(['greet', 'shuot']);
    expect(flow.errors).toBe(1);
    expect(flow.diagnostics[0]).toMatchObject({ code: 'E1201', line: 2 });
    expect(flow.diagnostics[0]!.message).toContain('Did you mean `shout`?');
    await source.close?.();
  });

  it('a diagram with errors has no graph but still has its text and problems', async () => {
    const folder = project('broken', { 'bad.mmd': 'flowchart TD\n  a --- b\n' });
    const source = await fileSource({ paths: [path.join(folder, 'bad.mmd')], watch: false });
    const flow = (await source.getFlow(source.single()!))!;
    expect(flow.graph).toBeUndefined();
    expect(flow.version).toBeUndefined();
    expect(flow.diagram.source).toContain('a --- b');
    expect(flow.diagnostics.map((d) => d.code)).toEqual(['E1005']);
    await source.close?.();
  });

  it('a tools file that cannot be loaded is reported, and the diagram is still shown', async () => {
    const folder = project('badtools', { 'a.mmd': 'flowchart TD\n  x --> y\n', 'tools.mjs': 'throw new Error("boom at load");\n' });
    const source = await fileSource({ paths: [folder], watch: false });
    const flow = (await source.getFlow((await source.listFlows()).flows[0]!.id))!;
    expect(flow.toolsError).toContain('boom at load');
    expect(flow.errors).toBe(1);
    expect(flow.graph!.nodes.map((n) => n.kind)).toEqual(['unbound', 'unbound']);
    await source.close?.();
  });

  it('with tools turned off, no code is imported', async () => {
    const marker = path.join(dir, 'was-imported');
    const folder = project('notools', { 'a.mmd': 'flowchart TD\n  x\n', 'tools.mjs': `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, '1');\nexport const x = 1;\n` });
    const source = await fileSource({ paths: [folder], tools: false, watch: false });
    const flow = (await source.getFlow((await source.listFlows()).flows[0]!.id))!;
    expect(source.toolsFiles()).toEqual([]);
    expect(flow.toolsFile).toBeUndefined();
    expect(flow.inputs).toBeUndefined();
    expect(readdirSync(dir)).not.toContain('was-imported');
    await source.close?.();
  });

  it('reports a missing path plainly', async () => {
    await expect(fileSource({ paths: [path.join(dir, 'nope')] })).rejects.toThrow(/^Not found: /);
  });
});

describe('viewer handler', () => {
  const make = async () => createViewerHandler(await fileSource({ paths: [examples], watch: false }), { ui });

  it('serves the contract as JSON under /api/v1', async () => {
    const handler = await make();
    const meta = (await (await get(handler, '/api/v1/meta')).json()) as Meta;
    expect(meta.schemaVersion).toBe(1);
    const list = (await (await get(handler, '/api/v1/flows')).json()) as FlowList;
    expect(list.flows).toHaveLength(6);
    const response = await get(handler, `/api/v1/flows/${list.flows[1]!.id}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(((await response.json()) as FlowView).title).toBe('Hello');
  });

  it('answers unknown things with a JSON error', async () => {
    const handler = await make();
    for (const [url, status, code] of [['/api/v1/flows/nope', 404, 'not_found'], ['/api/v1/runs', 404, 'not_supported'], ['/api/v2/meta', 404, 'not_found'], ['/missing.js', 404, 'not_found']] as const) {
      const response = await get(handler, url);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
  });

  it('is read-only: anything but GET and HEAD is refused', async () => {
    const handler = await make();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await get(handler, '/api/v1/flows', { method })).status).toBe(405);
    }
    expect((await get(handler, '/api/v1/flows', { method: 'HEAD' })).status).toBe(200);
  });

  it('refuses requests under an unexpected host name or from another site', async () => {
    const handler = await make();
    expect((await get(handler, '/api/v1/flows', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await get(handler, '/api/v1/flows', { headers: { host: 'localhost:4747', origin: 'http://evil.example' } })).status).toBe(403);
    expect((await get(handler, '/api/v1/flows', { headers: { host: 'localhost:4747', origin: 'http://localhost:4747' } })).status).toBe(200);
    expect((await get(handler, '/api/v1/flows', { headers: { host: '192.168.1.20:4747' } })).status).toBe(200);
    const open = createViewerHandler(await fileSource({ paths: [examples], watch: false }), { ui, allowedHosts: ['flows.internal'] });
    expect((await get(open, '/api/v1/flows', { headers: { host: 'flows.internal' } })).status).toBe(200);
  });

  it('serves the page with protective headers and never reads files by request path', async () => {
    const handler = await make();
    const page = await get(handler, '/');
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
    expect((await get(handler, '/app-0a1b2c3d4e.js')).headers.get('cache-control')).toContain('immutable');
    for (const sneaky of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/../package.json']) {
      const response = await get(handler, sneaky);
      expect(await response.text()).not.toContain('"devDependencies"');
    }
    expect(await (await get(handler, '/some/page')).text()).toContain('<title>ui</title>');
  });
});

describe('view()', () => {
  it('serves the built page and the data on this machine only, and stops cleanly', async () => {
    const server = await view(examples, { port: 48110, watch: false });
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    expect(server.toolsFiles).toContain('hello/tools.ts');
    const page = await (await fetch(server.url)).text();
    expect(page).toContain('id="viewer-config"');
    expect(page).toContain('"apiBase": "api/v1"');
    const script = /src="\.\/([^"]+\.js)"/.exec(page)![1]!;
    expect((await fetch(`${server.url}${script}`)).headers.get('content-type')).toContain('javascript');
    expect(((await (await fetch(`${server.url}api/v1/flows`)).json()) as FlowList).flows).toHaveLength(6);
    await server.close();
    await expect(fetch(server.url)).rejects.toThrow();
  });

  it('one file opens straight on that diagram', async () => {
    const server = await view(path.join(examples, 'hello/hello.mmd'), { port: 48120, watch: false });
    expect(server.url).toMatch(/#\/flow\/[A-Za-z0-9_-]+$/);
    await server.close();
  });

  it('moves to the next port when the first is taken, unless told not to', async () => {
    const first = await view(examples, { port: 48130, watch: false });
    const second = await view(examples, { port: 48130, watch: false });
    expect(second.port).toBe(48131);
    await expect(view(examples, { port: 48130, strictPort: true, watch: false })).rejects.toThrow('Port 48130 is already in use.');
    await first.close();
    await second.close();
  });

  it('pushes a change to the page when a file is saved', async () => {
    const folder = project('live', { 'flow.mmd': 'flowchart TD\n  a --> b\n' });
    const server = await view(folder, { port: 48140, tools: false });
    const events: ViewerEvent[] = [];
    const abort = new AbortController();
    const response = await fetch(`${server.url}api/v1/events`, { signal: abort.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    void (async () => {
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value).split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as ViewerEvent);
        }
      } catch {
        // the request is aborted at the end of the test
      }
    })();
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(path.join(folder, 'flow.mmd'), 'flowchart TD\n  a --> b --> c\n');
    expect(await until(() => events.length > 0)).toBe(true);
    expect(events[0]).toMatchObject({ type: 'flows.changed', revision: 2 });
    const flows = (await (await fetch(`${server.url}api/v1/flows`)).json()) as FlowList;
    expect(flows.revision).toBe(2);
    expect(flows.flows[0]!.counts.nodes).toBe(3);
    writeFileSync(path.join(folder, 'second.mmd'), 'flowchart TD\n  x\n');
    expect(await until(() => events.length > 1)).toBe(true);
    expect(((await (await fetch(`${server.url}api/v1/flows`)).json()) as FlowList).flows).toHaveLength(2);
    abort.abort();
    await server.close();
  });

  it('the command prints the address and serves it', async () => {
    const child = spawn(process.execPath, [path.join(root, 'dist/cli.mjs'), 'view', 'examples', '--no-open', '--port', '48150'], { cwd: root });
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    try {
      expect(await until(() => out.includes('Ctrl+C'), 8000)).toBe(true);
      expect(out).toContain('http://127.0.0.1:48150/');
      expect(out).toContain('their code was loaded');
      expect(((await (await fetch('http://127.0.0.1:48150/api/v1/meta')).json()) as Meta).rootName).toBe('examples');
    } finally {
      child.kill('SIGINT');
    }
  });
});

describe('layering', () => {
  const pkg = path.join(root, 'packages/view');
  const read = (file: string) => readFileSync(path.join(pkg, file), 'utf8');
  const imports = (text: string) => [...text.matchAll(/from\s+'([^']+)'|import\('([^']+)'\)/g)].map((m) => m[1] ?? m[2]!);
  const all = (dir: string) => readdirSync(path.join(pkg, dir)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${dir}/${f}`);

  it('the UI takes only types from the server side, and only from the contract', () => {
    for (const file of all('ui/src')) {
      for (const spec of imports(read(file)).filter((i) => i.startsWith('../'))) expect(spec, file).toBe('../../src/contract.ts');
      for (const line of read(file).split('\n').filter((l) => l.includes('/src/contract.ts'))) expect(line, file).toMatch(/^import type /);
    }
  });

  it('the contract imports nothing, and the handler knows only the contract and the source interface', () => {
    expect(imports(read('src/contract.ts'))).toEqual([]);
    expect(imports(read('src/handler.ts')).sort()).toEqual(['./contract.ts', './source.ts']);
    expect(imports(read('src/source.ts'))).toEqual(['./contract.ts']);
  });

  it('the viewer uses the core only through its public entry points, never its source files', () => {
    const outside = [...all('src'), ...all('ui/src')].flatMap((f) => imports(read(f)).filter((i) => i.startsWith('../../') && !f.startsWith('ui/')).map((i) => `${f}: ${i}`));
    expect(outside).toEqual([]);
    const core = all('src').filter((f) => imports(read(f)).some((i) => i === BRAND.name || i.startsWith(`${BRAND.name}/`)));
    expect(core.sort()).toEqual(['src/project.ts', 'src/source-fs.ts']);
    // The translation layer needs only types, so it can run anywhere.
    expect(read('src/project.ts')).not.toMatch(/from 'node:/);
    expect(read('src/project.ts')).toMatch(new RegExp(`^import type .* from '${BRAND.name}';$`, 'm'));
  });

  it('the product name appears only as the name of the package being imported', () => {
    const offenders = [...all('src'), ...all('ui/src')].filter((f) =>
      read(f).replace(new RegExp(`from '${BRAND.name}(/[a-z]+)?'`, 'g'), '').toLowerCase().includes(BRAND.name),
    );
    expect(offenders).toEqual([]);
  });

  it('the core never imports the viewer by a fixed name, so it is never bundled in', () => {
    const src = path.join(root, 'src');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
    const users = files(src).filter((f) => readFileSync(f, 'utf8').includes(BRAND.viewPackage)).map((f) => path.relative(src, f));
    expect(users).toEqual(['brand.ts']);
    expect(readdirSync(path.join(root, 'dist'))).not.toContain('ui');
  });

  it('both packages carry the same version', () => {
    const version = (file: string) => (JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { version: string }).version;
    expect(VERSION).toBe(version('package.json'));
    expect(version('packages/view/package.json')).toBe(VERSION);
  });
});
