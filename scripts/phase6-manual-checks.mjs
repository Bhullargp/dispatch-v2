import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS upload_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
  );
`);

const cols = db.prepare('PRAGMA table_info(upload_jobs)').all();
const colNames = new Set(cols.map((c) => c.name));
const requiredDefs = {
  attempt_count: 'INTEGER NOT NULL DEFAULT 0',
  max_attempts: 'INTEGER NOT NULL DEFAULT 3',
  cancel_requested: 'INTEGER NOT NULL DEFAULT 0',
  started_at: 'TEXT',
  last_error_at: 'TEXT',
  processing_by: 'TEXT',
};

for (const [col, def] of Object.entries(requiredDefs)) {
  if (!colNames.has(col)) db.exec(`ALTER TABLE upload_jobs ADD COLUMN ${col} ${def}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS upload_worker_lock (
    lock_name TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const colsAfter = db.prepare('PRAGMA table_info(upload_jobs)').all();
const afterNames = new Set(colsAfter.map((c) => c.name));
const missing = Object.keys(requiredDefs).filter((c) => !afterNames.has(c));

const adminByUsername = db.prepare('SELECT id, username, email, role FROM users WHERE username = ?').get('admin');
const adminByEmail = db.prepare('SELECT id, username, email, role FROM users WHERE email = ?').get('admin@dispatch.local');

const statusCounts = db.prepare(`
  SELECT status, COUNT(*) AS c
  FROM upload_jobs
  GROUP BY status
  ORDER BY status
`).all();

console.log('\n=== Phase 6 Manual Checks ===');
console.log('DB:', dbPath);
console.log('Upload job columns present:', missing.length === 0 ? 'YES' : `NO (missing: ${missing.join(', ')})`);
console.log('Admin login row via username:', adminByUsername ? 'YES' : 'NO');
console.log('Admin login row via email:', adminByEmail ? 'YES' : 'NO');
console.log('Upload status counts:', statusCounts.length ? statusCounts : 'none');

if (missing.length > 0) process.exitCode = 1;
