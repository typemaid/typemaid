import { BRAND } from '../brand.ts';
import type { InferIn, InferOut, StandardSchema } from './schema.ts';

const MARK: unique symbol = Symbol.for(BRAND.symbolKey) as never;

/** What every tool receives as its second argument. */
export interface ToolContext {
  runId: string;
  nodeId: string;
  /** The same value every time this step is retried or re-run after a crash. Pass it to APIs that support idempotency keys. */
  key: string;
  /** 1 for the first try. */
  attempt: number;
  /** Aborted when the step times out or the run is cancelled. */
  signal: AbortSignal;
  /** Whatever was passed as `auth` to run(). Never stored with the run. */
  auth: unknown;
  /**
   * Ask a model for a structured answer from inside a tool. The answer is checked against
   * `output` (and the model is asked once more if it does not fit). The call stops when the
   * step is cancelled or times out.
   */
  ask<O extends StandardSchema>(request: AskRequest & { output: O }): Promise<InferOut<O>>;
  /** Ask a model for plain text from inside a tool. */
  text(request: AskRequest): Promise<string>;
}

export interface AskRequest {
  prompt: string;
  /** Fixed guidance for the model. */
  instructions?: string;
  /** An AI SDK model. Falls back to the `model` option of run(). */
  model?: unknown;
}

interface Common {
  description?: string;
  /** Extra tries after the first one fails. Default 0. */
  retries?: number;
  /** Give up on one try after this many milliseconds. */
  timeoutMs?: number;
}

export interface ToolSpec<I, O> extends Common {
  /** The fields this tool needs. They are picked out of the flow's shared context by name. */
  input?: I;
  /** The fields this tool adds to the shared context. */
  output?: O;
  run: (input: InferOut<I>, ctx: ToolContext) => InferIn<O> | Promise<InferIn<O>>;
}

export interface AgentSpec<O> extends Common {
  /** Text sent to the model. `{field}` is replaced by that field from the shared context. */
  prompt: string;
  /** Fixed guidance for the model. Placeholders are not allowed here. */
  instructions?: string;
  /** The fields the model must return. */
  output: O;
  /** An AI SDK model. Falls back to the `model` option of run(). */
  model?: unknown;
  /** AI SDK tools the model may call while it works out its answer. Needs `maxSteps`. */
  tools?: Record<string, unknown>;
  /** Most model turns allowed when `tools` are given. */
  maxSteps?: number;
}

export interface HumanSpec<R> {
  description?: string;
  /** The fields a person must supply to continue the run. */
  resume?: R;
}

export type ToolDef = { readonly kind: 'tool'; readonly spec: ToolSpec<unknown, unknown> };
export type AgentDef = { readonly kind: 'agent'; readonly spec: AgentSpec<unknown> };
export type HumanDef = { readonly kind: 'human'; readonly spec: HumanSpec<unknown> };
export type StepDef = ToolDef | AgentDef | HumanDef;

function mark<T extends StepDef>(def: T): T {
  Object.defineProperty(def, MARK, { value: def.kind, enumerable: false });
  return Object.freeze(def);
}

/** A step that runs your code. */
export function tool<I extends StandardSchema | undefined = undefined, O extends StandardSchema | undefined = undefined>(
  spec: ToolSpec<I, O>,
): ToolDef {
  return mark({ kind: 'tool', spec: spec as unknown as ToolSpec<unknown, unknown> });
}

/** A step that asks a model for structured output. */
export function agent<O extends StandardSchema>(spec: AgentSpec<O>): AgentDef {
  return mark({ kind: 'agent', spec: spec as AgentSpec<unknown> });
}

/** A step that pauses the run until a person answers. */
export function human<R extends StandardSchema | undefined = undefined>(spec: HumanSpec<R> = {}): HumanDef {
  return mark({ kind: 'human', spec: spec as HumanSpec<unknown> });
}

/** Recognises tool(), agent() and human() results, including ones made by another copy of this package. */
export function stepDefOf(value: unknown): StepDef | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const kind = (value as Record<symbol, unknown>)[MARK];
  return kind === 'tool' || kind === 'agent' || kind === 'human' ? (value as StepDef) : undefined;
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}/g;

/** The context paths a prompt template reads. */
export function placeholders(template: string): string[][] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!.split('.'));
}

export function renderTemplate(template: string, read: (path: string[]) => unknown): string {
  return template.replace(PLACEHOLDER, (_, path: string) => {
    const value = read(path.split('.'));
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}
