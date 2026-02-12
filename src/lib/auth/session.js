export const AUTH_COOKIE_NAME = 'tv_auth_session';
export const AUTH_COOKIE_VALUE = '1';

export const getAuthConfig = () => ({
  username: String(process.env.AUTH_USERNAME || '').trim(),
  password: String(process.env.AUTH_PASSWORD || '').trim(),
  secret: String(process.env.AUTH_SECRET || '').trim()
});

export const isAuthConfigured = () => {
  const { username, password, secret } = getAuthConfig();
  return Boolean(username && password && secret);
};
