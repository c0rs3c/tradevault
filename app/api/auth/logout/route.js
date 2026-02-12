import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth/session';

const useSecureCookie = (request) => {
  const override = String(process.env.AUTH_COOKIE_SECURE || '').trim();
  if (override === '1') return true;
  if (override === '0') return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) return forwardedProto.includes('https');
  return request.nextUrl.protocol === 'https:';
};

export async function POST(request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: useSecureCookie(request),
    path: '/',
    maxAge: 0
  });
  return response;
}
