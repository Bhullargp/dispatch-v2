export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import TripSheetClient from './TripSheetClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';

export default async function TripSheetPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  // Check if user needs setup wizard
  const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  if (!user?.setup_complete) {
    redirect('/dispatch/setup');
  }

  // Redirect to dashboard as default landing page
  redirect('/dispatch/dashboard');
}
