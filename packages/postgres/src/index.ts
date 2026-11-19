import { StaleRunError, type RunRecord, type Store } from 'typemaid';

/**
 * The part of a Postgres client this store uses. A `Pool` or `Client` from `pg` fits as it is,
 * and so do the clients that copy its `query` function (Neon, Vercel Postgres, PGlite).
 */
export interface PostgresClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number | null }>;
}

export interface PostgresStoreOptions {
  /** Table name, optionally with a schema: `runs` or `app.runs`. Default `flow_runs`. */
  table?: string;
  /** Set to false if you create the table yourself with `postgresSchema()`. Default true. */
  createTable?: boolean;
}

const DEFAULT_TABLE = 'flow_runs';

function quoted(table: string): string {
  const parts = table.split('.');
  if (parts.length > 2 || !parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) {
    throw new Error(`Table name ${JSON.stringify(table)} must be letters, digits and "_", optionally as schema.table.`);
  }
  return parts.map((p) => `"${p}"`).join('.');
}

/** The SQL that creates the table, for projects that keep their own migrations. Safe to run twice. */
export function postgresSchema(table: string = DEFAULT_TABLE): string {
  return `CREATE TABLE IF NOT EXISTS ${quoted(table)} (
  tenant TEXT NOT NULL,
  run_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  flow_hash TEXT NOT NULL,
  flow TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant, run_id)
)`;
}

/**
 * Saves runs in Postgres. You own the connection: this never opens or closes one.
 * The table is created on first use. Every save is one statement that only succeeds
 * if nobody else has moved the run on.
 */
export function postgresStore(db: PostgresClient, options: PostgresStoreOptions = {}): Store {
  const table = quoted(options.table ?? DEFAULT_TABLE);
  const schema = postgresSchema(options.table ?? DEFAULT_TABLE);
  const insert = `INSERT INTO ${table} (tenant, run_id, version, status, flow_hash, flow, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant, run_id) DO NOTHING`;
  const select = `SELECT flow, body FROM ${table} WHERE tenant = $1 AND run_id = $2`;
  const update = `UPDATE ${table} SET version = $1, status = $2, body = $3, updated_at = $4 WHERE tenant = $5 AND run_id = $6 AND version = $7`;

  let ready: Promise<unknown> | undefined;
  const prepare = (): Promise<unknown> | undefined => {
    if (options.createTable === false) return undefined;
    // Two servers starting together can both try to create the table, and Postgres fails one of them.
    // The second try finds the table already there.
    ready ??= db
      .query(schema)
      .catch(() => db.query(schema))
      .catch((err: unknown) => {
        ready = undefined;
        throw err;
      });
    return ready;
  };
  const changed = (result: { rowCount?: number | null; affectedRows?: number | null }): number => result.rowCount ?? result.affectedRows ?? 0;
  // The diagram never changes during a run, so it is written once and left out of every later save.
  // The record is kept as TEXT, not JSONB: it comes back exactly as saved, and JSONB refuses some strings.
  const body = (record: RunRecord): string => JSON.stringify({ ...record, flow: undefined });

  return {
    async create(record) {
      await prepare();
      const result = await db.query(insert, [record.tenant, record.runId, record.version, record.status, record.flow.hash, JSON.stringify(record.flow), body(record), record.createdAt, record.updatedAt]);
      if (changed(result) !== 1) throw new Error(`Run ${record.runId} already exists.`);
    },
    async load(tenant, runId) {
      await prepare();
      const row = (await db.query(select, [tenant, runId])).rows[0] as { flow: string; body: string } | undefined;
      if (!row) return undefined;
      return { ...(JSON.parse(row.body) as Omit<RunRecord, 'flow'>), flow: JSON.parse(row.flow) as RunRecord['flow'] };
    },
    async save(record, expectedVersion) {
      await prepare();
      const result = await db.query(update, [record.version, record.status, body(record), record.updatedAt, record.tenant, record.runId, expectedVersion]);
      if (changed(result) !== 1) throw new StaleRunError(record.runId);
    },
  };
}
