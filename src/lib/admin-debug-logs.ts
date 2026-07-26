import { db, shouldRunRuntimeSchemaEnsures } from '@/lib/db';

export type AdminDebugLogLevel = 'info' | 'warn' | 'error';

export type AdminDebugLogEntry = {
  category: string;
  event: string;
  level?: AdminDebugLogLevel;
  message?: string | null;
  userId?: number | null;
  tripNumber?: string | null;
  provider?: string | null;
  model?: string | null;
  documentId?: number | null;
  draftId?: number | null;
  fileName?: string | null;
  traceId?: string | null;
  data?: Record<string, unknown> | null;
};

function sanitizeData(data?: Record<string, unknown> | null) {
  if (!data) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (/api[_-]?key|authorization|token|secret|password/i.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && value.length > 1200) {
      output[key] = `${value.slice(0, 1200)}…`;
      continue;
    }
    output[key] = value;
  }
  return output;
}

export async function ensureAdminDebugLogsTable() {
  if (!shouldRunRuntimeSchemaEnsures()) return;

  await db().run(`
    CREATE TABLE IF NOT EXISTS admin_debug_logs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      category TEXT NOT NULL,
      event TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT,
      user_id INTEGER,
      trip_number TEXT,
      provider TEXT,
      model TEXT,
      document_id INTEGER,
      draft_id INTEGER,
      file_name TEXT,
      trace_id TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db().run('CREATE INDEX IF NOT EXISTS idx_admin_debug_logs_created_at ON admin_debug_logs (created_at DESC)').catch(() => {});
  await db().run('CREATE INDEX IF NOT EXISTS idx_admin_debug_logs_trace_id ON admin_debug_logs (trace_id)').catch(() => {});
  await db().run('CREATE INDEX IF NOT EXISTS idx_admin_debug_logs_category ON admin_debug_logs (category)').catch(() => {});
}

export async function writeAdminDebugLog(entry: AdminDebugLogEntry) {
  await ensureAdminDebugLogsTable();
  await db().run(
    `INSERT INTO admin_debug_logs (
      category,
      event,
      level,
      message,
      user_id,
      trip_number,
      provider,
      model,
      document_id,
      draft_id,
      file_name,
      trace_id,
      data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      entry.category,
      entry.event,
      entry.level || 'info',
      entry.message || null,
      entry.userId || null,
      entry.tripNumber || null,
      entry.provider || null,
      entry.model || null,
      entry.documentId || null,
      entry.draftId || null,
      entry.fileName || null,
      entry.traceId || null,
      JSON.stringify(sanitizeData(entry.data)),
    ]
  );
}

export async function listAdminDebugLogs(limit = 150, traceId?: string | null) {
  await ensureAdminDebugLogsTable();
  return await db().query(
    `SELECT
      id,
      created_at::text AS created_at,
      category,
      event,
      level,
      message,
      user_id,
      trip_number,
      provider,
      model,
      document_id,
      draft_id,
      file_name,
      trace_id,
      data
    FROM admin_debug_logs
    WHERE ($2::text IS NULL OR trace_id = $2)
    ORDER BY created_at DESC, id DESC
    LIMIT $1`,
    [limit, traceId || null]
  ) as Array<any>;
}

export async function clearAdminDebugLogs() {
  await ensureAdminDebugLogsTable();
  await db().run('TRUNCATE TABLE admin_debug_logs RESTART IDENTITY', []);
}
