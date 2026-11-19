import { StaleRunError, type RunRecord, type Store } from 'typemaid';

/** The part of a libSQL client this store uses. A client from `@libsql/client` fits as it is. */
export interface LibsqlClient {
  execute(statement: { sql: string; args: Array<string | number | null> }): Promise<{ rows: ArrayLike<unknown>; rowsAffected: number }>;
}

export interface LibsqlStoreOptions {
  /** Table name. Default `flow_runs`. */
  table?: string;
  /** Set to false if you create the table yourself with `libsqlSchema()`. Default true. */
  createTable?: boolean;
}

const DEFAULT_TABLE = 'flow_runs';

function quoted(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`Table name ${JSON.stringify(table)} must be letters, digits and "_".`);
  return `"${table}"`;
}

/** The SQL that creates the table, for projects that keep their own migrations. Safe to run twice. */
export function libsqlSchema(table: string = DEFAULT_TABLE): string {
  return `CREATE TABLE IF NOT EXISTS ${quoted(table)} (
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
)`;
}

/**
 * Saves runs in libSQL: a local file, a libSQL server, or Turso. You own the client: this never opens or closes one.
 * The table is created on first use. Every save is one statement that only succeeds
 * if nobody else has moved the run on.
 */
export function libsqlStore(client: LibsqlClient, options: LibsqlStoreOptions = {}): Store {
  const table = quoted(options.table ?? DEFAULT_TABLE);
  const schema = libsqlSchema(options.table ?? DEFAULT_TABLE);
  const insert = `INSERT INTO ${table} (tenant, run_id, version, status, flow_hash, flow, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant, run_id) DO NOTHING`;
  const select = `SELECT flow, body FROM ${table} WHERE tenant = ? AND run_id = ?`;
  const update = `UPDATE ${table} SET version = ?, status = ?, body = ?, updated_at = ? WHERE tenant = ? AND run_id = ? AND version = ?`;

  let ready: Promise<unknown> | undefined;
  const prepare = (): Promise<unknown> | undefined => {
    if (options.createTable === false) return undefined;
    ready ??= client.execute({ sql: schema, args: [] }).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    return ready;
  };
  // The diagram never changes during a run, so it is written once and left out of every later save.
  const body = (record: RunRecord): string => JSON.stringify({ ...record, flow: undefined });

  return {
    async create(record) {
      await prepare();
      const result = await client.execute({ sql: insert, args: [record.tenant, record.runId, record.version, record.status, record.flow.hash, JSON.stringify(record.flow), body(record), record.createdAt, record.updatedAt] });
      if (result.rowsAffected !== 1) throw new Error(`Run ${record.runId} already exists.`);
    },
    async load(tenant, runId) {
      await prepare();
      const row = (await client.execute({ sql: select, args: [tenant, runId] })).rows[0] as { flow: unknown; body: unknown } | undefined;
      if (!row) return undefined;
      return { ...(JSON.parse(String(row.body)) as Omit<RunRecord, 'flow'>), flow: JSON.parse(String(row.flow)) as RunRecord['flow'] };
    },
    async save(record, expectedVersion) {
      await prepare();
      const result = await client.execute({ sql: update, args: [record.version, record.status, body(record), record.updatedAt, record.tenant, record.runId, expectedVersion] });
      if (result.rowsAffected !== 1) throw new StaleRunError(record.runId);
    },
  };
}
