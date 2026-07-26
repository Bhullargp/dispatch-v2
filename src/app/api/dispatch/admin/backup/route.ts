import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

const BACKUP_TABLES = [
  'users',
  'trips',
  'stops',
  'extra_pay',
  'fuel',
  'trip_expenses',
  'deductions',
  'user_documents',
  'upload_jobs',
  'document_processing_drafts',
  'trailer_inventory',
  'mileage_rates',
  'pay_rates',
  'extra_pay_items',
  'custom_pay_rules',
  'trip_rules',
  'user_settings',
  'safety_bonus',
  'pay_period_status',
];

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const schemaRow = await db().get('SELECT current_schema() AS schema', []) as { schema?: string } | undefined;
    const schema = schemaRow?.schema || process.env.DB_SCHEMA || 'dispatch';
    const tables: Record<string, any[]> = {};
    const counts: Record<string, number> = {};

    for (const table of BACKUP_TABLES) {
      const exists = await db().get(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'`,
        [schema, table]
      );
      if (!exists) continue;

      const rows = await db().query(`SELECT * FROM ${table} ORDER BY 1`, []);
      tables[table] = rows;
      counts[table] = rows.length;
    }

    const backup = {
      format: 'dispatch-admin-json-backup-v1',
      created_at: new Date().toISOString(),
      schema,
      source: process.env.DATABASE_URL ? 'hosted-postgres' : 'local-postgres',
      table_order: Object.keys(tables),
      counts,
      tables,
    };

    const body = JSON.stringify(backup, null, 2);
    return new NextResponse(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="dispatch-backup-${timestampSlug()}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Backup failed' }, { status: 500 });
  }
}
