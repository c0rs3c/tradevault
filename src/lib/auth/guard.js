import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE_NAME, getSessionUsername } from './session';

export const requireAuth = async () => {
  const cookieStore = await cookies();
  const session = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!getSessionUsername(session)) {
    redirect('/login');
  }
};
