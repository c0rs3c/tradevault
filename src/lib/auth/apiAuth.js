import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, getSessionUsername } from './session';

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const requireApiUsername = async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const username = getSessionUsername(token);
  if (!username) {
    throw createError('Unauthorized', 401);
  }
  return username;
};
