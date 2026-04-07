import pool, { db } from '@/lib/db';

export type AuditAction = 
  | 'login_success' | 'login_failed' | 'login_locked'
  | 'password_change' | 'password_reset'
  | 'profile_update' | 'avatar_upload' | 'avatar_delete'
  | 'trip_create' | 'trip_update' | 'trip_delete'
  | 'pay_period_mark_paid' | 'pay_period_assign'
  | 'settings_change'
  | 'document_upload' | 'document_delete';

export async function auditLog(params: {
  userId?: number;
  action: AuditAction;
  details?: string;
  ip?: string;
}) {
  try {
    await db().run(
      'INSERT INTO admin_audit_log (actor_user_id, action, metadata, created_at) VALUES ($1, $2, $3, datetime(\'now\'))',
      [params.userId || null, params.action, params.details || '']
    );
  } catch (e) {
    // Audit logging should never break the app
    console.error('Audit log error:', e);
  }
}
