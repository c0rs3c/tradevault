import { NextResponse } from 'next/server';
import {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_VALUE,
  isAuthConfigured,
  isValidCredentials
} from '@/lib/auth/session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const useSecureCookie = (request) => {
  const override = String(process.env.AUTH_COOKIE_SECURE || '').trim();
  if (override === '1') return true;
  if (override === '0') return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) return forwardedProto.includes('https');
  return request.nextUrl.protocol === 'https:';
};

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

  if (!isValidCredentials(username, password)) {
    return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, AUTH_COOKIE_VALUE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: useSecureCookie(request),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  return response;
}
