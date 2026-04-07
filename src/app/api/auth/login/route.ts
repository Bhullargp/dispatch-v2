import { NextResponse } from 'next/server';
import {
  authConfig,
  createSessionToken,
  ensureDispatchAuthSchemaAndSeed,
  findUserByLogin,
  verifySecret
} from '@/lib/dispatch-auth';
import { checkLoginRateLimit, recordFailedAttempt, resetLoginAttempts } from '@/lib/rate-limit';
import { auditLog } from '@/lib/audit-log';

function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
    || request.headers.get('x-real-ip') 
    || 'unknown';
}

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const body = await request.json();
    const login = String(body.login || body.email || '').trim();
    const password = String(body.password || '');
    const ip = getClientIp(request);

    if (!login || !password) {
      return NextResponse.json({ error: 'Login and password are required' }, { status: 400 });
    }

    // Rate limit check
    const rateCheck = checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
      const mins = Math.ceil((rateCheck.remainingMs || 0) / 60000);
      await auditLog({ action: 'login_locked', details: `IP ${ip} locked for ${mins}min`, ip });
      return NextResponse.json({ 
        error: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` 
      }, { status: 429 });
    }

    const user = await findUserByLogin(login);
    if (!user || !verifySecret(password, user.password_hash)) {
      const result = recordFailedAttempt(ip);
      await auditLog({ action: 'login_failed', details: `Login: ${login}`, ip });
      
      if (result.lockedOut) {
        const mins = Math.ceil((result.remainingMs || 0) / 60000);
        return NextResponse.json({ 
          error: `Account locked. Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` 
        }, { status: 429 });
      }
      
      const remaining = 5 - (attempts.get(ip)?.count || 0);
      return NextResponse.json({ 
        error: `Invalid credentials. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` 
      }, { status: 401 });
    }

    // Success - reset rate limit
    resetLoginAttempts(ip);

    const mustChangePassword = !!user.force_password_change;

    const token = createSessionToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      mustChangePassword
    });

    await auditLog({ userId: user.id, action: 'login_success', ip });

    const res = NextResponse.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, mustChangePassword }
    });
    res.cookies.set(authConfig.sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: Math.floor(authConfig.sessionTtlMs / 1000),
      path: '/'
    });
    return res;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Login failed' }, { status: 500 });
  }
}

// Need to import attempts for the remaining count
import { attempts } from '@/lib/rate-limit';
