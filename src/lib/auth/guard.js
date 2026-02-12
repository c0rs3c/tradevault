import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const AUTH_COOKIE_NAME = 'tv_auth_session';
const AUTH_COOKIE_VALUE = '1';

export const requireAuth = async () => {
  const cookieStore = await cookies();
  const session = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (session !== AUTH_COOKIE_VALUE) {
    redirect('/login');
  }
};

