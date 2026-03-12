import { NextResponse } from 'next/server';
import { getRequestAccess } from './ownership';

export function requireAuth(request: Request): NextResponse | null {
  const access = getRequestAccess(request);
  if (!access) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
