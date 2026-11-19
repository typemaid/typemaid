import { DatabaseSync } from 'node:sqlite';
import type { CompiledFlow } from '../core/compile.ts';
import { StaleRunError, type RunRecord, type Store } from '../exec/store.ts';

export interface SqliteStore extends Store {
  close(): void;
}

/**
 * Saves runs in a SQLite file using Node's built-in driver, so paused runs survive restarts.
 * Every save is one statement that only succeeds if nobody else has moved the run on.
 */
export function sqliteStore(path: string): SqliteStore {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS runs (
    tenant TEXT NOT NULL,
    run_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    flow_hash TEXT NOT NULL,
    flow TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant, run_id)
  )`);
  const insert = db.prepare(
    'INSERT INTO runs (tenant, run_id, version, status, flow_hash, flow, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const select = db.prepare('SELECT flow, body FROM runs WHERE tenant = ? AND run_id = ?');
  const update = db.prepare(
    'UPDATE runs SET version = ?, status = ?, body = ?, updated_at = ? WHERE tenant = ? AND run_id = ? AND version = ?',
  );
  // The diagram never changes during a run, so it is written once and left out of every later save.
  const body = (record: RunRecord): string => JSON.stringify({ ...record, flow: undefined });

  return {
    async create(record) {
      try {
        insert.run(record.tenant, record.runId, record.version, record.status, record.flow.hash, JSON.stringify(record.flow), body(record), record.createdAt, record.updatedAt);
      } catch (err) {
        if (err instanceof Error && /UNIQUE|PRIMARY KEY/i.test(err.message)) throw new Error(`Run ${record.runId} already exists.`);
        throw err;
      }
    },
    async load(tenant, runId) {
      const row = select.get(tenant, runId) as { flow: string; body: string } | undefined;
      if (!row) return undefined;
      return { ...(JSON.parse(row.body) as Omit<RunRecord, 'flow'>), flow: JSON.parse(row.flow) as CompiledFlow };
    },
    async save(record, expectedVersion) {
      const result = update.run(record.version, record.status, body(record), record.updatedAt, record.tenant, record.runId, expectedVersion);
      if (Number(result.changes) !== 1) throw new StaleRunError(record.runId);
    },
    close() {
      db.close();
    },
  };
}
