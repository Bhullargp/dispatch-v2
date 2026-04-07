export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/dispatch-auth';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('dispatch_session')?.value;
  const session = verifySessionToken(token);

  if (!session) redirect('/dispatch/login');

  return <DashboardClient isAdmin={session.role === 'admin'} />;
}
