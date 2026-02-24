import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getSessionUsername } from '@/lib/auth/session';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout', '/api/health']);

const isPublicAssetPath = (pathname) =>
  pathname.startsWith('/_next/') ||
  pathname === '/favicon.ico' ||
  pathname.startsWith('/public/') ||
  /\.[a-zA-Z0-9]+$/.test(pathname);

export function middleware(request) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || isPublicAssetPath(pathname)) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthed = Boolean(getSessionUsername(sessionToken));
  if (isAuthed) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  const nextPath = `${pathname}${search || ''}`;
  loginUrl.searchParams.set('next', nextPath);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: '/:path*'
};
