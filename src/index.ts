import { BRAND, RUN_FORMAT } from './brand.ts';
import { bind, type BoundFlow, type Tools } from './bind/bind.ts';
import { validate } from './bind/schema.ts';
import { check, compile, type CompiledFlow, type CompileOptions } from './core/compile.ts';
import { Diagnostics, FlowError } from './core/diagnostics.ts';
import { normalizeSource } from './core/parse.ts';
import type { RunEvent } from './exec/events.ts';
import { Engine, newState, waitingAt, type AgentRunner, type EngineEnv, type Limits, type Waiting } from './exec/executor.ts';
import { memoryStore, type RunFailure, type RunRecord, type Store } from './exec/store.ts';

export { agent, human, tool } from './bind/helpers.ts';
export type { AgentSpec, AskRequest, HumanSpec, StepDef, ToolContext, ToolSpec } from './bind/helpers.ts';
export { bind } from './bind/bind.ts';
export type { BoundFlow, Tools } from './bind/bind.ts';
export type { FieldShape, Shape, StandardSchema } from './bind/schema.ts';
export { check, compile } from './core/compile.ts';
export type { CheckResult, CompiledFlow, CompileOptions, IREdge, IRForeach, IRNode } from './core/compile.ts';
export { FlowError, formatDiagnostic, formatDiagnostics } from './core/diagnostics.ts';
export type { Diagnostic } from './core/diagnostics.ts';
export { runDiagram } from './exec/events.ts';
export type { RunEvent } from './exec/events.ts';
export { RunError } from './exec/executor.ts';
export type { AgentRequest, AgentRunner, Limits, Waiting } from './exec/executor.ts';
export { memoryStore, StaleRunError } from './exec/store.ts';
export type { RunFailure, RunRecord, RunState, RunStatus, Store } from './exec/store.ts';
export { BRAND, VERSION } from './brand.ts';

export type RunResult =
  | { status: 'completed'; runId: string; output: Record<string, unknown> }
  | { status: 'paused'; runId: string; waitingAt: Waiting[] }
  | { status: 'failed'; runId: string; error: RunFailure };

export interface RunOptions {
  /** Where runs are saved. Default: in memory, lost when the process exits. */
  store?: Store;
  tenant?: string;
  runId?: string;
  /** Which `:::start` node to begin at, when the diagram has several. */
  start?: string;
  /** Credentials for your tools. Passed to every tool, never stored with the run. */
  auth?: unknown;
  /** Default AI SDK model for agent steps. */
  model?: unknown;
  /** Replace the model call, e.g. with a fake in tests. */
  runAgent?: AgentRunner;
  onEvent?: (event: RunEvent) => void;
  signal?: AbortSignal;
  limits?: Limits;
  /** Wait between retries. Replace in tests to avoid real delays. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResumeOptions extends Omit<RunOptions, 'runId' | 'start'> {
  /** Which waiting step the answer is for, when more than one is waiting. */
  node?: string;
}

/** A diagram: a file path or URL, the Mermaid text itself, or an already compiled flow. */
export type FlowInput = string | URL | CompiledFlow;

// Used when no store is passed. Bounded so a long-lived process does not grow without limit.
const sharedStore = memoryStore({ maxRuns: 1000 });
const compiled = new Map<string, CompiledFlow>();

/** A string is read as a file only when it clearly names one; anything else is diagram text. */
function looksLikePath(text: string): boolean {
  return !text.includes('\n') && (text.startsWith('file:') || BRAND.extensions.some((ext) => text.endsWith(ext)));
}

/** Read and compile a diagram. Compiled results are cached by content. */
export async function load(input: FlowInput, options: CompileOptions = {}): Promise<{ flow: CompiledFlow; source?: string }> {
  if (typeof input === 'object' && !(input instanceof URL)) return { flow: input };
  let source: string;
  let file = options.file;
  if (typeof input === 'string' && !looksLikePath(input)) {
    source = input;
  } else {
    // Reading files only exists on server runtimes. The module names are kept out of reach of
    // bundlers so that the core still builds for browsers and edge runtimes, where a diagram
    // is passed as text instead.
    const names = ['node:fs/promises', 'node:path', 'node:url'];
    let mods: [typeof import('node:fs/promises'), typeof import('node:path'), typeof import('node:url')];
    try {
      mods = (await Promise.all(names.map((name) => import(/* @vite-ignore */ name)))) as typeof mods;
    } catch {
      throw new Error('Reading a diagram from a file is not available in this runtime. Pass the diagram text (or a compiled flow) to run() instead.');
    }
    const [{ readFile }, path, url] = mods;
    const abs = input instanceof URL || input.startsWith('file:') ? url.fileURLToPath(input) : path.resolve(input);
    if (!BRAND.extensions.some((ext) => abs.endsWith(ext))) {
      throw new Error(`Expected a diagram file ending in ${BRAND.extensions.join(', ')}; got ${abs}`);
    }
    try {
      source = await readFile(abs, 'utf8');
    } catch (err) {
      const code = (err as { code?: string }).code;
      throw new Error(code === 'ENOENT' ? `Diagram file not found: ${typeof input === 'string' ? input : abs}` : `Could not read ${abs}: ${(err as Error).message}`);
    }
    file ??= path.relative(process.cwd(), abs).split(path.sep).join('/');
  }
  source = normalizeSource(source);
  const key = `${file ?? ''}\u0000${source}`;
  let flow = compiled.get(key);
  if (!flow) {
    flow = compile(source, file === undefined ? options : { ...options, file });
    if (compiled.size >= 200) compiled.clear();
    compiled.set(key, flow);
  }
  return { flow, source };
}

/** Start a run and continue until it completes, pauses for a person, or fails. */
export async function run(
  flowInput: FlowInput,
  tools: Tools,
  input: Record<string, unknown> = {},
  options: RunOptions = {},
): Promise<RunResult> {
  const { flow, source } = await load(flowInput);
  const bound = bind(flow, tools, source);
  const entry = options.start ?? flow.entries[0]!;
  const diags = new Diagnostics(flow.file);
  if (!flow.entries.includes(entry)) {
    diags.error('E1302', `\`${entry}\` is not a start node. Start nodes: ${flow.entries.join(', ')}.`);
    throw new FlowError(diags.list);
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    diags.error('E1301', 'The input to run() must be an object of fields.');
    throw new FlowError(diags.list);
  }
  const missing = Object.entries(bound.inputs[entry] ?? {})
    .filter(([field, shape]) => shape.required && (!Object.hasOwn(input, field) || input[field] === undefined))
    .map(([field]) => field)
    .sort();
  if (missing.length > 0) {
    const readers = bound.neededBy[entry] ?? {};
    const detail = missing.map((field) => (readers[field] ? `${field} (needed by \`${readers[field]}\`)` : field)).join(', ');
    diags.error('E1301', `run() is missing input: ${detail}.`, flow.nodes[readers[missing[0]!] ?? entry], 'No step produces these fields, so they must be passed to run(). Check the spelling if a step was meant to produce one.');
    throw new FlowError(diags.list, source);
  }

  const now = new Date().toISOString();
  const record: RunRecord = {
    format: RUN_FORMAT,
    tenant: options.tenant ?? 'default',
    runId: options.runId ?? crypto.randomUUID(),
    flow,
    status: 'running',
    state: newState(input, entry),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const store = options.store ?? sharedStore;
  await store.create(record);
  try {
    options.onEvent?.({ type: 'run.start', runId: record.runId, entry });
  } catch {
    // A listener must never break a run.
  }
  return continueRun(bound, record, store, options, undefined);
}

/**
 * Continue a run: answer a waiting human step, retry a failed run,
 * or pick up a run whose process died.
 */
export async function resume(
  runId: string,
  tools: Tools,
  payload: Record<string, unknown> = {},
  options: ResumeOptions = {},
): Promise<RunResult> {
  const store = options.store ?? sharedStore;
  const record = await store.load(options.tenant ?? 'default', runId);
  if (!record) throw new Error(`Run ${runId} was not found in this store.`);
  if (record.format !== RUN_FORMAT) {
    throw new Error(`Run ${runId} was saved in format ${record.format}; this version reads format ${RUN_FORMAT}.`);
  }
  const bound = bind(record.flow, tools);
  if (record.status === 'completed') return { status: 'completed', runId, output: record.state.ctx };

  let answered: number | undefined;
  const waiting = record.state.tokens.filter((t) => t.waiting);
  const answering = options.node !== undefined || Object.keys(payload).length > 0;
  if (waiting.length === 0 && answering && record.status !== 'paused') {
    throw new Error(`Run ${runId} is not waiting for an answer (status: ${record.status}). Call resume() without an answer to retry it.`);
  }
  // A failed run can still have a step waiting for a person (another branch failed meanwhile).
  if (record.status === 'paused' || (waiting.length > 0 && answering)) {
    const names = waiting.map((t) => t.node);
    const token = options.node === undefined ? (waiting.length === 1 ? waiting[0] : undefined) : waiting.find((t) => t.node === options.node);
    if (!token) {
      throw new Error(
        options.node === undefined
          ? `Run ${runId} is waiting at several steps (${names.join(', ')}). Pass { node } to say which one you are answering.`
          : `Run ${runId} is not waiting at \`${options.node}\`. It is waiting at: ${names.join(', ')}.`,
      );
    }
    const node = record.flow.nodes[token.node]!;
    const def = bound.steps.get(token.node);
    let value: unknown = payload;
    if (def?.kind === 'human' && def.spec.resume !== undefined) {
      const checked = await validate(def.spec.resume, payload);
      if (!checked.ok) throw new Error(`The answer for \`${token.node}\` is not valid: ${checked.issues.join('; ')}.`);
      value = checked.value;
    }
    const fields = { ...(value as Record<string, unknown>) };
    if (node.route === 'choice') {
      const allowed = node.out.map((i) => record.flow.edges[i]!.branch!);
      const decision = payload.decision;
      if (typeof decision !== 'string' || !allowed.includes(decision)) {
        throw new Error(`The answer for \`${token.node}\` needs \`decision\` to be one of: ${allowed.join(', ')}.`);
      }
      fields.decision = decision;
    }
    for (const [key, v] of Object.entries(JSON.parse(JSON.stringify(fields)) as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      record.state.ctx[key] = v;
    }
    answered = token.id;
  }
  delete record.error;
  record.status = 'running';
  return continueRun(bound, record, store, options, answered);
}

async function continueRun(
  bound: BoundFlow,
  record: RunRecord,
  store: Store,
  options: RunOptions,
  answered: number | undefined,
): Promise<RunResult> {
  const { runId } = record;
  let chain: Promise<void> = Promise.resolve();
  const commit = (): Promise<void> => {
    const snapshot: RunRecord = { ...record, state: JSON.parse(JSON.stringify(record.state)), updatedAt: new Date().toISOString() };
    const expected = record.version;
    record.version = expected + 1;
    snapshot.version = expected + 1;
    chain = chain.then(() => store.save(snapshot, expected));
    return chain;
  };
  const env: EngineEnv = {
    runId,
    auth: options.auth,
    model: options.model,
    runAgent: options.runAgent ?? (async (request) => (await import('./ai/adapter.ts')).runAgentWithAiSdk(request)),
    limits: {
      maxSteps: options.limits?.maxSteps ?? 10_000,
      timeoutMs: options.limits?.timeoutMs ?? 5 * 60_000,
      concurrency: options.limits?.concurrency ?? 5,
      maxContextChars: options.limits?.maxContextChars ?? 5_000_000,
    },
    emit: (event) => {
      try {
        options.onEvent?.(event);
      } catch {
        // A listener must never break a run.
      }
    },
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    commit,
    keyPrefix: '',
    budget: { used: record.state.steps },
    signal: options.signal ?? new AbortController().signal,
  };

  const engine = new Engine(bound, record.state, env);
  if (answered !== undefined) {
    const token = record.state.tokens.find((t) => t.id === answered)!;
    engine.release(token);
  }
  // The size limit also covers what comes in from outside: the input to run() and answers to resume().
  if (JSON.stringify(record.state.ctx).length > env.limits.maxContextChars) {
    engine.failure = { code: 'E1326', message: `The data given to the run is larger than the limit of ${env.limits.maxContextChars} characters.` };
  } else {
    await engine.drive();
  }

  let result: RunResult;
  if (engine.failure) {
    record.status = 'failed';
    record.error = engine.failure;
    result = { status: 'failed', runId, error: engine.failure };
  } else if (record.state.tokens.length === 0) {
    record.status = 'completed';
    result = { status: 'completed', runId, output: record.state.ctx };
  } else {
    record.status = 'paused';
    result = { status: 'paused', runId, waitingAt: waitingAt(bound, record.state) };
  }
  await commit();
  env.emit({ type: 'run.end', runId, status: result.status });
  return result;
}

/** Check a diagram and, when tools are given, its tools. Returns every problem instead of throwing. */
export function checkFlow(source: string, tools?: Tools, options: CompileOptions = {}) {
  const result = check(source, options);
  if (!result.flow || !tools) return result;
  try {
    const bound = bind(result.flow, tools, result.source);
    return { ...result, diagnostics: [...result.diagnostics, ...bound.warnings], bound };
  } catch (err) {
    if (!(err instanceof FlowError)) throw err;
    return { source: result.source, diagnostics: [...result.diagnostics, ...err.diagnostics] };
  }
}
