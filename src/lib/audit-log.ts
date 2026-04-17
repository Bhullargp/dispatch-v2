import { db } from '@/lib/db';

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
    const actor = params.userId
      ? await db().get('SELECT id, username FROM users WHERE id = $1', [params.userId]) as { id: number; username: string } | undefined
      : await db().get('SELECT id, username FROM users ORDER BY id ASC LIMIT 1', []) as { id: number; username: string } | undefined;

    if (!actor) return;

    const metadata = JSON.stringify({
      details: params.details || '',
      ip: params.ip || ''
    });

    await db().run(
      `INSERT INTO admin_audit_log (
        actor_user_id,
        actor_username,
        target_user_id,
        target_username,
        action,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'))`,
      [
        actor.id,
        actor.username,
        actor.id,
        actor.username,
        params.action,
        metadata,
      ]
    );
  } catch (e) {
    // Audit logging should never break the app
    console.error('Audit log error:', e);
  }
}
