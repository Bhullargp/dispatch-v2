import { Pool } from 'pg';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'dispatch_user',
  password: 'karandeep@',
  database: 'masterdb',
  options: '-c search_path=dispatch',
});

const requiredCols = [
  'attempt_count',
  'max_attempts',
  'cancel_requested',
  'started_at',
  'last_error_at',
  'processing_by',
];

async function main() {
  const uploadJobsTable = await pool.query(`SELECT to_regclass('dispatch.upload_jobs') AS exists`);
  const workerLockTable = await pool.query(`SELECT to_regclass('dispatch.upload_worker_lock') AS exists`);

  const cols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'dispatch' AND table_name = 'upload_jobs'
  `);
  const colNames = new Set(cols.rows.map((c) => c.column_name));
  const missing = requiredCols.filter((c) => !colNames.has(c));

  const adminByUsername = await pool.query(
    'SELECT id, username, email, role FROM users WHERE username = $1 LIMIT 1',
    ['admin']
  );
  const adminByEmail = await pool.query(
    'SELECT id, username, email, role FROM users WHERE email = $1 LIMIT 1',
    ['admin@dispatch.local']
  );

  const statusCounts = await pool.query(`
    SELECT status, COUNT(*) AS c
    FROM upload_jobs
    GROUP BY status
    ORDER BY status
  `);

  console.log('\n=== Phase 6 Manual Checks ===');
  console.log('DB: masterdb / schema=dispatch');
  console.log('upload_jobs table:', uploadJobsTable.rows[0]?.exists ? 'YES' : 'NO');
  console.log('upload_worker_lock table:', workerLockTable.rows[0]?.exists ? 'YES' : 'NO');
  console.log('Upload job columns present:', missing.length === 0 ? 'YES' : `NO (missing: ${missing.join(', ')})`);
  console.log('Admin login row via username:', adminByUsername.rows[0] ? 'YES' : 'NO');
  console.log('Admin login row via email:', adminByEmail.rows[0] ? 'YES' : 'NO');
  console.log('Upload status counts:', statusCounts.rows.length ? statusCounts.rows : 'none');

  if (!uploadJobsTable.rows[0]?.exists || missing.length > 0) process.exitCode = 1;
}

main().finally(() => pool.end());
