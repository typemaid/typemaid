import type { BoundFlow } from '../bind/bind.ts';
import { renderTemplate, type AgentDef, type StepDef, type ToolContext, type ToolDef } from '../bind/helpers.ts';
import { shapeOf, validate, type Shape } from '../bind/schema.ts';
import type { IRNode } from '../core/compile.ts';
import { evalExpr, readPath } from '../core/expr.ts';
import type { RunEvent } from './events.ts';
import { StaleRunError, type RunFailure, type RunRecord, type RunState, type Store, type Token } from './store.ts';

/** A problem while running a flow. `code` is stable; `message` is for people. */
export class RunError extends Error {
  readonly code: string;
  readonly node: string | undefined;
  /** False when trying again cannot help (bad input, bad output, a limit was hit). */
  readonly retryable: boolean;
  constructor(code: string, message: string, options: { node?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RunError';
    this.code = code;
    this.node = options.node;
    this.retryable = options.retryable ?? false;
  }
}

export interface AgentRequest {
  node: string;
  prompt: string;
  instructions?: string;
  /** The output schema the answer must match. Absent when plain text is wanted. */
  schema?: unknown;
  model: unknown;
  /** AI SDK tools the model may call, with the most turns it may take. */
  tools?: Record<string, unknown>;
  maxSteps?: number;
  signal: AbortSignal;
}

/** Produces the answer for a model call: an object when a schema is given, otherwise text. The default one calls the Vercel AI SDK. */
export type AgentRunner = (request: AgentRequest) => Promise<unknown>;

export interface Limits {
  /** Most node executions in one run. Default 10 000. */
  maxSteps?: number;
  /** Default time limit for one try of one step, in milliseconds. Default 5 minutes. */
  timeoutMs?: number;
  /** Items of a for-each block that run at the same time. Default 5. */
  concurrency?: number;
  /** Largest shared context, in characters of JSON. Default 5 000 000. */
  maxContextChars?: number;
}

export interface EngineEnv {
  runId: string;
  auth: unknown;
  model: unknown;
  runAgent: AgentRunner;
  limits: Required<Limits>;
  emit: (event: RunEvent) => void;
  sleep: (ms: number) => Promise<void>;
  /** Persist the current state. Resolves once it is stored. */
  commit: () => Promise<void>;
  /** Prefix for idempotency keys (set inside for-each items). */
  keyPrefix: string;
  /** Node executions so far in the whole run, shared with for-each items. */
  budget: { used: number };
  signal: AbortSignal;
}

export interface Waiting {
  node: string;
  label?: string;
  /** Fields the person must supply. */
  fields?: Shape;
  /** Allowed values for `decision`, when the arrows leaving the node are labelled. */
  options?: string[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const inputShapes = new WeakMap<object, Shape | null>();

function jsonClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function newState(input: Record<string, unknown>, entry: string): RunState {
  return { ctx: jsonClone(input), tokens: [{ id: 1, node: entry }], forks: {}, seq: 1, counters: {}, visits: {}, steps: 0 };
}

export function toFailure(err: unknown, node?: string): RunFailure {
  const failure: RunFailure =
    err instanceof RunError
      ? { code: err.code, message: err.message }
      : { code: 'E1399', message: err instanceof Error ? err.message : String(err) };
  const at = (err instanceof RunError ? err.node : undefined) ?? node;
  if (at !== undefined) failure.node = at;
  return failure;
}

/** Moves the tokens of one scope (the whole run, or one for-each item) until none can move. */
export class Engine {
  failure: RunFailure | undefined;
  fatal: unknown;
  /** Names of context fields written by this engine. */
  readonly written = new Set<string>();
  private readonly bound: BoundFlow;
  private readonly state: RunState;
  private readonly env: EngineEnv;
  private readonly inflight = new Set<Promise<void>>();
  private readonly abort = new AbortController();
  private readonly resumed = new Set<number>();

  constructor(bound: BoundFlow, state: RunState, env: EngineEnv) {
    this.bound = bound;
    this.state = state;
    this.env = env;
  }

  /** Mark a waiting token as answered; the next drive() continues past its node. */
  release(token: Token): void {
    delete token.waiting;
    this.resumed.add(token.id);
  }

  async drive(): Promise<void> {
    const stop = () => {
      if (!this.failure) this.failure = { code: 'E1330', message: 'The run was cancelled.' };
      this.abort.abort();
    };
    if (this.env.signal.aborted) stop();
    else this.env.signal.addEventListener('abort', stop, { once: true });
    try {
      for (const token of [...this.state.tokens]) if (!token.waiting) this.spawn(token);
      while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
    } finally {
      this.env.signal.removeEventListener('abort', stop);
    }
    if (this.fatal !== undefined) throw this.fatal;
  }

  private spawn(token: Token): void {
    const p: Promise<void> = this.advance(token)
      .catch((err: unknown) => {
        if (err instanceof StaleRunError) this.fatal ??= err;
        else if (!this.failure) this.failure = toFailure(err, token.node);
        this.abort.abort();
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  private async advance(token: Token): Promise<void> {
    const { flow } = this.bound;
    const { state, env } = this;
    for (;;) {
      if (this.abort.signal.aborted) return;
      const node = flow.nodes[token.node]!;
      const answered = this.resumed.delete(token.id);

      if (!answered && token.fork !== undefined && state.forks[token.fork]?.join === node.id) {
        this.remove(token);
        this.branchDone(token.fork);
        await env.commit();
        return;
      }
      if (++env.budget.used > env.limits.maxSteps) {
        throw new RunError('E1310', `The run was stopped after ${env.limits.maxSteps} steps.`, { node: node.id });
      }
      state.steps = env.budget.used;

      const started = Date.now();
      let choice: string | undefined;
      if (node.kind === 'decision') {
        choice = this.decide(node) ? 'yes' : 'no';
        env.emit({ type: 'branch', runId: env.runId, node: node.id, taken: choice });
      } else if (node.kind === 'foreach') {
        await this.foreach(node);
      } else if (node.kind === 'step') {
        const def = this.bound.steps.get(node.id)!;
        if (def.kind === 'human') {
          if (!answered) {
            token.waiting = true;
            env.emit({ type: 'run.paused', runId: env.runId, node: node.id });
            await env.commit();
            return;
          }
        } else {
          const key = `${env.runId}:${env.keyPrefix}${node.id}:${state.visits[node.id] ?? 0}`;
          env.emit({ type: 'node.start', runId: env.runId, node: node.id, key });
          const output = await this.execute(node, def, key);
          if (this.abort.signal.aborted) return;
          this.merge(output, node.id);
        }
        if (node.route === 'choice') {
          choice = String(state.ctx.decision);
          env.emit({ type: 'branch', runId: env.runId, node: node.id, taken: choice });
        }
      }
      // Work out where to go next before counting this visit, so that a routing failure
      // leaves the step's idempotency key unchanged when the run is retried.
      let index: number | undefined;
      if (node.out.length > 0 && node.route !== 'fork') {
        index = node.out[0]!;
        if (choice !== undefined) {
          const found = node.out.find((i) => flow.edges[i]!.branch === choice);
          if (found === undefined) {
            const options = node.out.map((i) => flow.edges[i]!.branch).join(', ');
            throw new RunError('E1311', `\`${node.id}\` chose \`${choice}\`, but its arrows are labelled: ${options}.`, { node: node.id });
          }
          index = found;
        }
        const edge = flow.edges[index]!;
        if (edge.max !== undefined && (state.counters[index] ?? 0) >= edge.max) {
          throw new RunError('E1313', `The loop from \`${edge.from}\` back to \`${edge.to}\` reached its limit of ${edge.max}.`, { node: node.id });
        }
      }
      state.visits[node.id] = (state.visits[node.id] ?? 0) + 1;
      env.emit({ type: 'node.end', runId: env.runId, node: node.id, ms: Date.now() - started });

      if (node.out.length === 0) {
        this.remove(token);
        if (token.fork !== undefined) this.branchDone(token.fork);
        await env.commit();
        return;
      }
      if (index === undefined) {
        const forkId = String(++state.seq);
        state.forks[forkId] = { join: node.join ?? null, pending: node.out.length };
        if (token.fork !== undefined) state.forks[forkId].parent = token.fork;
        this.remove(token);
        const branches = node.out.map((i): Token => ({ id: ++state.seq, node: flow.edges[i]!.to, fork: forkId }));
        state.tokens.push(...branches);
        await env.commit();
        for (const b of branches) this.spawn(b);
        return;
      }
      const edge = flow.edges[index]!;
      if (edge.max !== undefined) {
        state.counters[index] = (state.counters[index] ?? 0) + 1;
        for (const inner of edge.resets ?? []) delete state.counters[inner];
      }
      token.node = edge.to;
      await env.commit();
    }
  }

  private remove(token: Token): void {
    const i = this.state.tokens.indexOf(token);
    if (i >= 0) this.state.tokens.splice(i, 1);
  }

  private branchDone(forkId: string): void {
    const fork = this.state.forks[forkId];
    if (!fork) return;
    if (--fork.pending > 0) return;
    delete this.state.forks[forkId];
    if (fork.join !== null) {
      const token: Token = { id: ++this.state.seq, node: fork.join };
      if (fork.parent !== undefined) token.fork = fork.parent;
      this.state.tokens.push(token);
      this.spawn(token);
    } else if (fork.parent !== undefined) {
      this.branchDone(fork.parent);
    }
  }

  private decide(node: IRNode): boolean {
    const cond = node.cond!;
    const ctx = this.state.ctx;
    if (cond.kind === 'expr') return Boolean(evalExpr(cond.ast, ctx));
    const predicate = this.bound.predicates.get(node.id);
    const value = predicate ? predicate(Object.freeze(jsonClone(ctx))) : readPath(ctx, [cond.name]);
    if (typeof value !== 'boolean') {
      const what = predicate ? `The function \`${cond.name}\` returned` : `The field \`${cond.name}\` is`;
      throw new RunError('E1312', `Decision \`${node.id}\` needs true or false. ${what} ${describe(value)}.`, { node: node.id });
    }
    return value;
  }

  private merge(output: unknown, nodeId: string): void {
    if (output === undefined || output === null) return;
    if (typeof output !== 'object' || Array.isArray(output)) {
      throw new RunError('E1322', `\`${nodeId}\` must return an object of fields, but returned ${describe(output)}.`, { node: nodeId });
    }
    const clean = jsonClone(output) as Record<string, unknown>;
    for (const key of Object.keys(clean)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new RunError('E1325', `\`${nodeId}\` returned a field named \`${key}\`, which is not allowed.`, { node: nodeId });
      }
      this.state.ctx[key] = clean[key];
      this.written.add(key);
    }
    if (JSON.stringify(this.state.ctx).length > this.env.limits.maxContextChars) {
      throw new RunError('E1326', `The data carried by the run grew past the limit of ${this.env.limits.maxContextChars} characters after \`${nodeId}\`.`, { node: nodeId });
    }
  }

  private async execute(node: IRNode, def: ToolDef | AgentDef, key: string): Promise<unknown> {
    const { env, state } = this;
    const retries = Math.max(0, def.spec.retries ?? 0);
    const timeoutMs = def.spec.timeoutMs ?? env.limits.timeoutMs;
    const name = node.ref!;

    let call: (signal: AbortSignal, attempt: number) => Promise<unknown>;
    if (def.kind === 'tool') {
      let input: unknown = jsonClone(state.ctx);
      if (def.spec.input !== undefined) {
        const schema = def.spec.input as object;
        if (!inputShapes.has(schema)) inputShapes.set(schema, shapeOf(schema, 'input') ?? null);
        const shape = inputShapes.get(schema);
        if (shape) {
          const picked: Record<string, unknown> = {};
          for (const field of Object.keys(shape)) {
            if (Object.hasOwn(state.ctx, field)) picked[field] = jsonClone(state.ctx[field]);
          }
          input = picked;
        }
        const checked = await validate(schema, input);
        if (!checked.ok) {
          throw new RunError('E1320', `\`${name}\` did not get the input it needs: ${checked.issues.join('; ')}.`, { node: node.id });
        }
        input = checked.value;
      }
      call = async (signal, attempt) => {
        const ctx: ToolContext = {
          runId: env.runId,
          nodeId: node.id,
          key,
          attempt,
          signal,
          auth: env.auth,
          ask: (request) => this.askModel(node.id, { ...request, schema: request.output }, signal) as never,
          text: async (request) => String(await this.askModel(node.id, request, signal)),
        };
        const output = await def.spec.run(input, ctx);
        if (def.spec.output === undefined) return undefined;
        const checked = await validate(def.spec.output, output);
        if (!checked.ok) {
          throw new RunError('E1322', `\`${name}\` returned output that does not match its schema: ${checked.issues.join('; ')}.`, { node: node.id });
        }
        return checked.value;
      };
    } else {
      const prompt = renderTemplate(def.spec.prompt, (path) => readPath(state.ctx, path));
      const { instructions, output, model, tools, maxSteps } = def.spec;
      call = (signal) =>
        this.askModel(
          node.id,
          {
            prompt,
            schema: output,
            ...(instructions !== undefined ? { instructions } : {}),
            ...(model !== undefined ? { model } : {}),
            ...(tools !== undefined ? { tools } : {}),
            ...(maxSteps !== undefined ? { maxSteps } : {}),
          },
          signal,
        );
    }

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.withTimeout((signal) => call(signal, attempt), timeoutMs, node.id);
      } catch (err) {
        if (this.abort.signal.aborted) throw err;
        const final = err instanceof RunError && !err.retryable;
        if (final || attempt > retries) {
          if (err instanceof RunError) throw err;
          const message = err instanceof Error ? err.message : String(err);
          throw new RunError('E1321', `\`${name}\` failed: ${message}`, { node: node.id, cause: err });
        }
        env.emit({ type: 'node.retry', runId: env.runId, node: node.id, attempt, error: err instanceof Error ? err.message : String(err) });
        // Wait before the next try, but stop waiting at once if the run is cancelled or has failed elsewhere.
        let wake = (): void => {};
        const stopped = new Promise<void>((resolve) => {
          wake = resolve;
          this.abort.signal.addEventListener('abort', wake, { once: true });
        });
        await Promise.race([env.sleep(Math.min(30_000, 200 * 2 ** (attempt - 1))), stopped]);
        this.abort.signal.removeEventListener('abort', wake);
        if (this.abort.signal.aborted) throw new RunError('E1330', 'The run was cancelled.', { node: node.id });
      }
    }
  }

  /**
   * One model call, shared by agent steps and by `ctx.ask` / `ctx.text` inside tools.
   * With a schema, the answer is validated; if it does not fit, the model is asked once more
   * and told what was wrong.
   */
  private async askModel(
    nodeId: string,
    request: { prompt: string; schema?: unknown; instructions?: string; model?: unknown; tools?: Record<string, unknown>; maxSteps?: number },
    signal: AbortSignal,
  ): Promise<unknown> {
    let prompt = request.prompt;
    for (let repair = 0; ; repair++) {
      const call: AgentRequest = { node: nodeId, prompt, model: request.model ?? this.env.model, signal };
      if (request.schema !== undefined) call.schema = request.schema;
      if (request.instructions !== undefined) call.instructions = request.instructions;
      if (request.tools !== undefined) call.tools = request.tools;
      if (request.maxSteps !== undefined) call.maxSteps = request.maxSteps;
      const answer = await this.env.runAgent(call);
      if (request.schema === undefined) return answer;
      const checked = await validate(request.schema, answer);
      if (checked.ok) return checked.value;
      if (repair >= 1) {
        throw new RunError('E1323', `The model's answer in \`${nodeId}\` does not match the output schema: ${checked.issues.join('; ')}.`, { node: nodeId });
      }
      prompt = `${request.prompt}\n\nYour previous answer was not valid:\n- ${checked.issues.join('\n- ')}\nAnswer again with every field correct.`;
    }
  }

  private withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, nodeId: string): Promise<T> {
    const local = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, local.signal]);
    return new Promise<T>((resolve, reject) => {
      if (this.abort.signal.aborted) {
        reject(new RunError('E1330', 'The run was cancelled.', { node: nodeId }));
        return;
      }
      // Timers cannot be longer than about 24 days; a larger or infinite value means no time limit.
      const timer = Number.isFinite(ms) && ms > 0 && ms <= 2_147_483_647
        ? setTimeout(() => {
            local.abort();
            reject(new RunError('E1324', `\`${nodeId}\` did not finish within ${ms} ms.`, { node: nodeId, retryable: true }));
          }, ms)
        : undefined;
      const onAbort = () => reject(new RunError('E1330', 'The run was cancelled.', { node: nodeId }));
      this.abort.signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => fn(signal))
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timer);
          this.abort.signal.removeEventListener('abort', onAbort);
        });
    });
  }

  private async foreach(node: IRNode): Promise<void> {
    const { env, state, bound } = this;
    const fe = bound.flow.foreach[node.id]!;
    const loop = bound.loops[node.id]!;
    const list = readPath(state.ctx, loop.list);
    if (!Array.isArray(list)) {
      throw new RunError('E1314', `For-each block \`${node.id}\` needs \`${loop.list.join('.')}\` to be a list, but it is ${describe(list)}.`, { node: node.id });
    }
    const outer = jsonClone(state.ctx);
    const results = new Array<Record<string, unknown>>(list.length);
    const visit = state.visits[node.id] ?? 0;
    let next = 0;
    let failure: RunFailure | undefined;
    // When one item fails, the items still running are stopped.
    const block = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, block.signal]);

    const worker = async (): Promise<void> => {
      while (next < list.length && !failure && !this.abort.signal.aborted) {
        const index = next++;
        const childState = newState({ ...outer, [loop.item]: list[index] }, fe.entry);
        const child = new Engine(bound, childState, {
          ...env,
          commit: async () => {},
          keyPrefix: `${env.keyPrefix}${node.id}.${visit}[${index}].`,
          signal,
        });
        await child.drive();
        if (child.failure) {
          failure ??= child.failure;
          block.abort();
          return;
        }
        const result: Record<string, unknown> = {};
        for (const field of child.written) result[field] = childState.ctx[field];
        results[index] = result;
      }
    };
    const limit = Number.isFinite(env.limits.concurrency) ? Math.floor(env.limits.concurrency) : 5;
    const width = Math.max(1, Math.min(limit, list.length));
    await Promise.all(Array.from({ length: width }, worker));
    if (failure) {
      throw new RunError(failure.code, failure.message, failure.node === undefined ? {} : { node: failure.node });
    }
    if (this.abort.signal.aborted) return;
    state.steps = env.budget.used;
    this.merge({ [node.id]: results }, node.id);
  }
}

function describe(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return `${typeof value === 'object' ? 'an object' : `the ${typeof value} ${JSON.stringify(value)}`}`;
}

/** What a paused run is waiting for. */
export function waitingAt(bound: BoundFlow, state: RunState): Waiting[] {
  return state.tokens
    .filter((t) => t.waiting)
    .map((t) => {
      const node = bound.flow.nodes[t.node]!;
      const def = bound.steps.get(t.node) as StepDef | undefined;
      const w: Waiting = { node: t.node };
      if (node.label !== undefined) w.label = node.label;
      if (def?.kind === 'human' && def.spec.resume !== undefined) {
        const fields = shapeOf(def.spec.resume, 'input');
        if (fields) w.fields = fields;
      }
      if (node.route === 'choice') w.options = node.out.map((i) => bound.flow.edges[i]!.branch!);
      return w;
    });
}

export type { RunRecord, Store };
