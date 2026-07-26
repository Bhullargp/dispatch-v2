import { Pool, type PoolConfig } from 'pg';

export type DbConfig = PoolConfig & {
  schema: string;
  options: string;
};

function parseIntWithDefault(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getDbConfig(): DbConfig {
  const schema = process.env.DB_SCHEMA || 'dispatch';
  const databaseUrl = process.env.DATABASE_URL;
  const max = parseIntWithDefault(process.env.DB_POOL_MAX, databaseUrl ? 5 : 10);
  const options = `-c search_path=${schema}`;

  if (databaseUrl) {
    const sslMode = (process.env.DB_SSL || 'require').toLowerCase();
    return {
      connectionString: databaseUrl,
      schema,
      max,
      options,
      ...(sslMode === 'disable' ? {} : { ssl: { rejectUnauthorized: sslMode === 'verify-full' } }),
    };
  }

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseIntWithDefault(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'dispatch_user',
    password: process.env.DB_PASSWORD || 'karandeep@',
    database: process.env.DB_NAME || 'masterdb',
    schema,
    max,
    options,
  };
}

export function shouldRunRuntimeSchemaEnsures() {
  if (process.env.ALLOW_RUNTIME_SCHEMA_ENSURES === 'true') return true;
  return !process.env.DATABASE_URL;
}

const pool = new Pool(getDbConfig());

export default pool;

// Small compatibility helper for older call sites, backed by PostgreSQL.
export function db() {
  return {
    async query(sql: string, params: any[] = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async get(sql: string, params: any[] = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? undefined;
    },
    async run(sql: string, params: any[] = []) {
      const result = await pool.query(sql, params);
      return { changes: result.rowCount ?? 0, rows: result.rows };
    },
  };
}
