export const AUTH_COOKIE_NAME = 'tv_auth_session';
export const AUTH_COOKIE_VALUE = '1';

const getUserPair = (usernameKey, passwordKey) => {
  const username = String(process.env[usernameKey] || '').trim();
  const password = String(process.env[passwordKey] || '').trim();
  if (!username || !password) return null;
  return { username, password };
};

export const getAuthUsers = () => {
  const users = [
    getUserPair('AUTH_USERNAME', 'AUTH_PASSWORD'),
    getUserPair('AUTH_USERNAME_2', 'AUTH_PASSWORD_2')
  ].filter(Boolean);
  return users;
};

export const getAuthConfig = () => ({
  secret: String(process.env.AUTH_SECRET || '').trim(),
  users: getAuthUsers()
});

export const isValidCredentials = (username, password) =>
  getAuthUsers().some((u) => u.username === username && u.password === password);

export const isAuthConfigured = () => {
  const { users, secret } = getAuthConfig();
  return Boolean(users.length > 0 && secret);
};
