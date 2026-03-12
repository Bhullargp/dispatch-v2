import Database from 'better-sqlite3';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authConfig, SessionPayload, verifySessionToken } from './dispatch-auth';

export type AccessContext = {
  session: SessionPayload;
  isAdmin: boolean;
  adminMode: boolean;
};

function parseCookieHeader(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
      })
  );
}

function parseAdminModeValue(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function getRequestAccess(request: Request): AccessContext | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookieMap = parseCookieHeader(cookieHeader);
  const token = cookieMap[authConfig.sessionCookie];
  const session = verifySessionToken(token);
  if (!session) return null;

  const qp = new URL(request.url).searchParams;
  const adminModeRequested = parseAdminModeValue(qp.get('adminMode')) || parseAdminModeValue(request.headers.get('x-admin-mode'));
  const isAdmin = session.role === 'admin';

  return {
    session,
    isAdmin,
    adminMode: isAdmin && adminModeRequested
  };
}

export async function getServerAccess(adminModeFlag?: string | string[]): Promise<AccessContext | null> {
  const store = await cookies();
  const token = store.get(authConfig.sessionCookie)?.value;
  const session = verifySessionToken(token);
  if (!session) return null;

  const isAdmin = session.role === 'admin';
  const rawFlag = Array.isArray(adminModeFlag) ? adminModeFlag[0] : adminModeFlag;

  return {
    session,
    isAdmin,
    adminMode: isAdmin && parseAdminModeValue(rawFlag)
  };
}

export function requireAccess(request: Request): { access?: AccessContext; response?: NextResponse } {
  const access = getRequestAccess(request);
  if (!access) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { access };
}

export function userScopedWhere(access: AccessContext, userIdColumn = 'user_id') {
  if (access.adminMode) return { clause: '1=1', params: [] as any[] };
  return { clause: `${userIdColumn} = ?`, params: [access.session.userId] as any[] };
}

export function ensureTripOwnership(db: Database.Database, access: AccessContext, tripNumber: string): boolean {
  if (access.adminMode) return true;
  const row = db.prepare('SELECT trip_number FROM trips WHERE trip_number = ? AND user_id = ?').get(tripNumber, access.session.userId);
  return !!row;
}
