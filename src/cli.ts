#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BRAND } from './brand.ts';
import { collect, findTools, loadTools, rel } from './node/files.ts';
import { checkFlow, FlowError, formatDiagnostics, resume, run, type Diagnostic, type RunEvent, type RunResult, type Store, type Tools } from './index.ts';

const HELP = `${BRAND.cli} - run Mermaid flowcharts as workflows

Usage:
  ${BRAND.cli} check [files or folders...] [--tools <file>] [--json]
  ${BRAND.cli} run <flow${BRAND.extensions[0]}> [--input <json | @file>] [--start <node>] [--tools <file>] [--store <file.db>]
  ${BRAND.cli} resume <runId> --store <file.db> --tools <file> [--answer <json | @file>] [--node <node>]
  ${BRAND.cli} view [files or folders...] [--port <n>] [--no-open] [--no-tools] [--tools <file>]

check   Reads each diagram and reports every problem, without running anything.
        When a tools file sits next to the diagram (${BRAND.toolsFiles[0]}), it is checked too.
run     Runs a flow and prints the result as JSON.
resume  Continues a paused or failed run.
view    Opens a page that draws your workflows. One file shows that diagram; a folder shows
        every workflow in it. The page updates when files change. It is only reachable from
        this computer, and it only reads.
`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  const valued = new Set(['tools', 'input', 'start', 'store', 'answer', 'node', 'port', 'host']);
  const switches = new Set(['json', 'help', 'no-open', 'no-tools', 'strict-port']);
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
      throw new Error(`Unknown option ${arg}. Options are written with two dashes, for example --input.`);
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (!valued.has(name) && !switches.has(name)) {
      throw new Error(`Unknown option --${name}. Options: ${[...valued, ...switches].map((n) => `--${n}`).join(', ')}.`);
    }
    if (!valued.has(name)) flags.set(name, true);
    else if (inline !== undefined) flags.set(name, inline);
    else {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value.`);
      flags.set(name, value);
    }
  }
  return { command: argv[0] ?? 'help', positional, flags };
}

async function readJson(value: string | true | undefined, flag: string): Promise<Record<string, unknown>> {
  if (value === undefined || value === true) return {};
  const text = value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`--${flag} must be a JSON object, for example --${flag} '{"name":"Ada"}'.`);
  }
}

async function openStore(file: string | true | undefined): Promise<(Store & { close?: () => void }) | undefined> {
  if (file === undefined || file === true) return undefined;
  const { sqliteStore } = await import('./sqlite/index.ts');
  return sqliteStore(path.resolve(file));
}

function printEvent(event: RunEvent): void {
  if (event.type === 'node.end') process.stderr.write(`  done    ${event.node} (${event.ms} ms)\n`);
  else if (event.type === 'node.retry') process.stderr.write(`  retry   ${event.node} (try ${event.attempt} failed: ${event.error})\n`);
  else if (event.type === 'branch') process.stderr.write(`  branch  ${event.node} -> ${event.taken}\n`);
  else if (event.type === 'run.paused') process.stderr.write(`  waiting ${event.node}\n`);
}

function finish(result: RunResult, storeFile: string | undefined, toolsFile: string): number {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'paused') {
    if (storeFile === undefined) {
      process.stderr.write(`\nPaused, but this run was not saved and cannot be continued. Run it again with --store <file.db>.\n`);
      return 1;
    }
    process.stderr.write(`\nPaused. Continue with: ${BRAND.cli} resume ${result.runId} --store ${storeFile} --tools ${rel(toolsFile)} --answer '{...}'\n`);
  }
  return result.status === 'failed' ? 1 : 0;
}

function onlyOne(args: Args, what: string): void {
  if (args.positional.length > 1) {
    throw new Error(`Unexpected argument \`${args.positional[1]}\`. ${what}`);
  }
}

async function commandCheck(args: Args): Promise<number> {
  const files: string[] = [];
  for (const target of args.positional.length > 0 ? args.positional : ['.']) await collect(path.resolve(target), files);
  if (files.length === 0) {
    process.stderr.write(`No diagram files (${BRAND.extensions.join(', ')}) found.\n`);
    return 1;
  }
  const all: Diagnostic[] = [];
  let errors = 0;
  let warnings = 0;
  const explicit = args.flags.get('tools');
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const toolsFile = await findTools(file, typeof explicit === 'string' ? explicit : undefined);
    const tools = toolsFile ? await loadTools(toolsFile) : undefined;
    const result = checkFlow(source, tools, { file: rel(file) });
    all.push(...result.diagnostics);
    const e = result.diagnostics.filter((d) => d.severity === 'error').length;
    errors += e;
    warnings += result.diagnostics.length - e;
    if (args.flags.has('json')) continue;
    const note = toolsFile ? `with ${rel(toolsFile)}` : 'diagram only, no tools file found';
    process.stdout.write(`${e > 0 ? 'FAIL' : 'ok  '}  ${rel(file)}  (${note})\n`);
    if (result.diagnostics.length > 0) process.stdout.write(`${formatDiagnostics(result.diagnostics, result.source)}\n\n`);
  }
  if (args.flags.has('json')) process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
  else process.stdout.write(`\n${files.length} file${files.length === 1 ? '' : 's'} checked: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.\n`);
  return errors > 0 ? 1 : 0;
}

async function commandRun(args: Args): Promise<number> {
  onlyOne(args, 'Pass input with --input.');
  const file = args.positional[0];
  if (file === undefined) throw new Error(`Say which flow to run: ${BRAND.cli} run flows/hello${BRAND.extensions[0]}`);
  const explicit = args.flags.get('tools');
  const toolsFile = await findTools(file, typeof explicit === 'string' ? explicit : undefined);
  if (!toolsFile) throw new Error(`No tools file found next to ${file}. Create ${BRAND.toolsFiles[0]} or pass --tools <file>.`);
  const tools = await loadTools(toolsFile);
  const input = await readJson(args.flags.get('input'), 'input');
  const store = await openStore(args.flags.get('store'));
  const start = args.flags.get('start');
  try {
    const result = await run(path.resolve(file), tools, input, {
      onEvent: printEvent,
      ...(store ? { store } : {}),
      ...(typeof start === 'string' ? { start } : {}),
    });
    const storeFlag = args.flags.get('store');
    return finish(result, typeof storeFlag === 'string' ? storeFlag : undefined, toolsFile);
  } finally {
    store?.close?.();
  }
}

async function commandResume(args: Args): Promise<number> {
  onlyOne(args, 'Pass the answer with --answer.');
  const runId = args.positional[0];
  const toolsFile = args.flags.get('tools');
  const store = await openStore(args.flags.get('store'));
  if (runId === undefined || typeof toolsFile !== 'string' || !store) {
    throw new Error(`Usage: ${BRAND.cli} resume <runId> --store <file.db> --tools <file> [--answer <json>]`);
  }
  try {
    const node = args.flags.get('node');
    const result = await resume(runId, await loadTools(path.resolve(toolsFile)), await readJson(args.flags.get('answer'), 'answer'), {
      store,
      onEvent: printEvent,
      ...(typeof node === 'string' ? { node } : {}),
    });
    return finish(result, String(args.flags.get('store')), path.resolve(toolsFile));
  } finally {
    store.close?.();
  }
}

interface ViewOptions {
  open?: boolean;
  strictPort?: boolean;
  tools?: string | false;
  port?: number;
  host?: string;
}
type ViewFn = (target: string[], options: ViewOptions) => Promise<{ url: string; toolsFiles: string[]; close(): Promise<void> }>;

async function commandView(args: Args): Promise<number> {
  // The viewer is a separate package, loaded by name so it is never bundled into this one.
  const name: string = BRAND.viewPackage;
  let view: ViewFn;
  try {
    ({ view } = (await import(name)) as { view: ViewFn });
  } catch (err) {
    if ((err as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND' || !String((err as Error).message).includes(name)) throw err;
    process.stderr.write(`The viewer is a separate package. Install it next to ${BRAND.name}:\n\n  npm install -D ${name}\n\n`);
    return 1;
  }
  const tools = args.flags.get('tools');
  const port = args.flags.get('port');
  const host = args.flags.get('host');
  if (port !== undefined && !/^\d+$/.test(String(port))) throw new Error('--port must be a number.');
  const server = await view(args.positional.length > 0 ? args.positional : ['.'], {
    open: !args.flags.has('no-open'),
    strictPort: args.flags.has('strict-port'),
    ...(args.flags.has('no-tools') ? { tools: false as const } : typeof tools === 'string' ? { tools } : {}),
    ...(port !== undefined ? { port: Number(port) } : {}),
    ...(typeof host === 'string' ? { host } : {}),
  });
  process.stdout.write(`\n  Workflows are at  ${server.url}\n`);
  if (server.toolsFiles.length > 0) {
    process.stdout.write(`  Read steps from   ${server.toolsFiles.join(', ')}  (their code was loaded; use --no-tools to avoid that)\n`);
  }
  if (typeof host === 'string' && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    process.stdout.write('  Warning: the page has no sign-in and is reachable from other computers on this address.\n');
  }
  process.stdout.write('  Press Ctrl+C to stop.\n\n');
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await server.close();
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.command === 'check') return commandCheck(args);
  if (args.command === 'run') return commandRun(args);
  if (args.command === 'resume') return commandResume(args);
  if (args.command === 'view') return commandView(args);
  process.stdout.write(HELP);
  return args.command === 'help' || args.command === '--help' || args.command === '-h' ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof FlowError) process.stderr.write(`${err.message}\n`);
    else process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
