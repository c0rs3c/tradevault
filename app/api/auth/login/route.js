import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, AUTH_COOKIE_VALUE, getAuthConfig, isAuthConfigured } from '@/lib/auth/session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function POST(request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { message: 'Authentication is not configured on server' },
      { status: 500 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const username = String(body?.username || '').trim();
  const password = String(body?.password || '').trim();
  const config = getAuthConfig();

  if (username !== config.username || password !== config.password) {
    return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, AUTH_COOKIE_VALUE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  return response;
}
