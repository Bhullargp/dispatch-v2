import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await ensureDispatchAuthSchemaAndSeed();
  const access = await getServerAccess();
  if (!access) redirect('/login');
  if (access.mustChangePassword) redirect('/login?forcePasswordChange=1');

  const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  
  return <SettingsClient userId={access.session.userId} role={access.session.role} setupComplete={!!user?.setup_complete} />;
}
