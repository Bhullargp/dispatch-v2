import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'dispatch_session';
const LEGACY_DISPATCH_PREFIX = '/dispatch';
const CLEAN_DISPATCH_PREFIXES = [
  '/dashboard',
  '/trips',
  '/active',
  '/documents',
  '/fuel-history',
  '/settings',
  '/admin',
  '/setup',
];

function isCleanDispatchPath(pathname: string) {
  return (
    CLEAN_DISPATCH_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    /^\/T\d+/i.test(pathname)
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  if (pathname === LEGACY_DISPATCH_PREFIX || pathname.startsWith(`${LEGACY_DISPATCH_PREFIX}/`)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname =
      pathname === LEGACY_DISPATCH_PREFIX ? '/dashboard' : pathname.slice(LEGACY_DISPATCH_PREFIX.length);
    return NextResponse.redirect(redirectUrl);
  }

  if (pathname === '/login' || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const shouldProtect = isCleanDispatchPath(pathname) || pathname.startsWith('/api/dispatch');
  if (!shouldProtect) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) return NextResponse.next();

  if (pathname.startsWith('/api/dispatch')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/:path*']
};
