/**
 * Model calls, set up in one place.
 *
 *   import { openai } from '@ai-sdk/openai';
 *   import { defineAI } from '<this package>/ai';
 *
 *   export const ai = defineAI({ model: openai('gpt-5-mini') });
 *   export const summarize = ai.agent({ prompt: 'Summarize: {text}', output: z.object({ ... }) });
 *
 * The provider (OpenAI, Anthropic, Google, ...) comes from the Vercel AI SDK's own packages;
 * any model they offer works here. This module itself imports nothing heavy: the AI SDK is
 * loaded the first time a model call actually runs.
 */
import { agent, type AgentDef, type AgentSpec, type AskRequest, type ToolContext } from '../bind/helpers.ts';
import type { InferOut, StandardSchema } from '../bind/schema.ts';

export { agent } from '../bind/helpers.ts';
export type { AgentSpec, AskRequest } from '../bind/helpers.ts';

export interface AIOptions {
  /** An AI SDK model, e.g. `openai('gpt-5-mini')` or `anthropic('claude-haiku-4-5')`. */
  model: unknown;
  /** Guidance added to every call that does not set its own. */
  instructions?: string;
}

export interface AI {
  /** A step that asks the model for structured output. */
  agent<O extends StandardSchema>(spec: AgentSpec<O>): AgentDef;
  /** Inside a tool: ask the model for a structured answer. Pass the tool's `ctx` so the call is cancelled with the step. */
  ask<O extends StandardSchema>(ctx: ToolContext, request: AskRequest & { output: O }): Promise<InferOut<O>>;
  /** Inside a tool: ask the model for plain text. */
  text(ctx: ToolContext, request: AskRequest): Promise<string>;
}

/** Choose the model (and optional standing instructions) once, and use it for every model call. */
export function defineAI(options: AIOptions): AI {
  const fill = <T extends { model?: unknown; instructions?: string }>(request: T): T => ({
    ...request,
    model: request.model ?? options.model,
    ...(request.instructions === undefined && options.instructions !== undefined ? { instructions: options.instructions } : {}),
  });
  return {
    agent: (spec) => agent(fill(spec)),
    ask: (ctx, request) => ctx.ask(fill(request)),
    text: (ctx, request) => ctx.text(fill(request)),
  };
}
