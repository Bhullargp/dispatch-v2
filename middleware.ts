import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'dispatch_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/dispatch/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const shouldProtect = pathname.startsWith('/dispatch') || pathname.startsWith('/api/dispatch');
  if (!shouldProtect) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) return NextResponse.next();

  if (pathname.startsWith('/api/dispatch')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/dispatch/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dispatch/:path*', '/api/dispatch/:path*', '/api/auth/:path*']
};
