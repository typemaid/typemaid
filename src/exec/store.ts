import type { CompiledFlow } from '../core/compile.ts';

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed';

/** A position in the diagram. A run has one, or several while branches run in parallel. */
export interface Token {
  id: number;
  node: string;
  /** The parallel block this token is a branch of. */
  fork?: string;
  /** True while the token sits at a human step. */
  waiting?: boolean;
}

export interface ForkState {
  /** Node where the branches meet, or null when they run to the end. */
  join: string | null;
  pending: number;
  parent?: string;
}

export interface RunState {
  ctx: Record<string, unknown>;
  tokens: Token[];
  forks: Record<string, ForkState>;
  seq: number;
  /** Times each capped arrow has been followed, by edge index. */
  counters: Record<string, number>;
  /** Times each node has completed. */
  visits: Record<string, number>;
  steps: number;
}

export interface RunFailure {
  code: string;
  message: string;
  node?: string;
}

export interface RunRecord {
  format: number;
  tenant: string;
  runId: string;
  /** The diagram exactly as it was when the run started. A run always finishes on this version. */
  flow: CompiledFlow;
  status: RunStatus;
  state: RunState;
  version: number;
  error?: RunFailure;
  createdAt: string;
  updatedAt: string;
}

/** Thrown when another worker has already moved the run on. */
export class StaleRunError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} was changed by someone else; this worker must stop.`);
    this.name = 'StaleRunError';
  }
}

export interface Store {
  create(record: RunRecord): Promise<void>;
  load(tenant: string, runId: string): Promise<RunRecord | undefined>;
  /**
   * Replace the stored run, but only if its stored version is `expectedVersion`.
   * Must be atomic, and must throw StaleRunError when the version does not match.
   */
  save(record: RunRecord, expectedVersion: number): Promise<void>;
}

/**
 * Keeps runs in memory. Runs are lost when the process exits.
 * With `maxRuns`, the oldest finished runs are dropped first; running and paused runs are never dropped.
 */
export function memoryStore(options: { maxRuns?: number } = {}): Store {
  const runs = new Map<string, string>();
  const finished = new Set<string>();
  const maxRuns = options.maxRuns ?? Infinity;
  const key = (tenant: string, runId: string) => `${tenant}\u0000${runId}`;
  const trim = () => {
    for (const k of finished) {
      if (runs.size <= maxRuns) break;
      runs.delete(k);
      finished.delete(k);
    }
  };
  return {
    async create(record) {
      const k = key(record.tenant, record.runId);
      if (runs.has(k)) throw new Error(`Run ${record.runId} already exists.`);
      runs.set(k, JSON.stringify(record));
      trim();
    },
    async load(tenant, runId) {
      const raw = runs.get(key(tenant, runId));
      return raw === undefined ? undefined : (JSON.parse(raw) as RunRecord);
    },
    async save(record, expectedVersion) {
      const k = key(record.tenant, record.runId);
      const raw = runs.get(k);
      if (raw === undefined || (JSON.parse(raw) as RunRecord).version !== expectedVersion) {
        throw new StaleRunError(record.runId);
      }
      runs.set(k, JSON.stringify(record));
      if (record.status === 'completed' || record.status === 'failed') finished.add(k);
      else finished.delete(k);
      trim();
    },
  };
}
