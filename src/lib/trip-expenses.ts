import { db, shouldRunRuntimeSchemaEnsures } from '@/lib/db';

export async function ensureTripExpensesReceiptColumns() {
  if (!shouldRunRuntimeSchemaEnsures()) return;

  await db().run('ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS expense_date TEXT').catch(() => {});
  await db().run('ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS location TEXT').catch(() => {});
  await db().run('ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS currency TEXT').catch(() => {});
  await db().run('ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS source TEXT').catch(() => {});
}
