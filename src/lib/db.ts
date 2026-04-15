import { Pool } from 'pg';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'dispatch_user',
  password: 'karandeep@',
  database: 'masterdb',
  options: '-c search_path=dispatch',
  max: 10,
});

export default pool;

// Helper that mimics better-sqlite3's synchronous API but async
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