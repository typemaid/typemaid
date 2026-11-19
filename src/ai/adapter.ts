import type { AgentRequest } from '../exec/executor.ts';
import { RunError } from '../exec/executor.ts';

/**
 * The only file that touches the Vercel AI SDK. It is loaded the first time an agent step runs,
 * so flows without agents work without the `ai` package installed.
 */
export async function runAgentWithAiSdk(request: AgentRequest): Promise<unknown> {
  if (request.model === undefined || request.model === null) {
    throw new RunError('E1340', `\`${request.node}\` makes a model call but no model is set. Set one with defineAI({ model }), agent({ model }) or run(..., { model }).`, { node: request.node });
  }
  let sdk: typeof import('ai');
  try {
    sdk = await import('ai');
  } catch (cause) {
    throw new RunError('E1341', `Agent \`${request.node}\` needs the "ai" package. Install it with: bun add ai (or npm i ai)`, { node: request.node, cause });
  }
  const options: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    abortSignal: request.signal,
    maxRetries: 0,
  };
  if (request.schema !== undefined) options.output = sdk.Output.object({ schema: request.schema as never });
  if (request.instructions !== undefined) options.instructions = request.instructions;
  if (request.tools !== undefined) {
    options.tools = request.tools;
    options.stopWhen = sdk.isStepCount(Math.max(1, request.maxSteps ?? 1));
  }
  try {
    const result = await sdk.generateText(options as never);
    return request.schema === undefined ? (result as { text: string }).text : (result as { output: unknown }).output;
  } catch (err) {
    if (sdk.NoObjectGeneratedError.isInstance(err)) {
      // Hand the raw text back so the executor can validate it and ask the model to repair it.
      const text = (err as { text?: string }).text;
      if (typeof text === 'string') {
        try {
          return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        } catch {
          return text;
        }
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new RunError('E1342', `The model call for \`${request.node}\` failed: ${message}`, { node: request.node, retryable: true, cause: err });
  }
}
