export const AUTH_COOKIE_NAME = 'tv_auth_session';
const AUTH_COOKIE_PREFIX = 'u:';

const decodeSessionUsername = (value) => {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return '';
  }
};

const getUserPair = (suffix = '') => {
  const usernameKey = `AUTH_USERNAME${suffix}`;
  const passwordKey = `AUTH_PASSWORD${suffix}`;
  const mongoUriKey = `MONGO_URI${suffix}`;
  const username = String(process.env[usernameKey] || '').trim();
  const password = String(process.env[passwordKey] || '').trim();
  const mongoUri = String(process.env[mongoUriKey] || '').trim();
  if (!username || !password || !mongoUri) return null;
  return { username, password, mongoUri };
};

export const getAuthUsers = () => {
  return ['', '_2', '_3', '_4', '_5'].map((suffix) => getUserPair(suffix)).filter(Boolean);
};

export const getAuthConfig = () => ({
  secret: String(process.env.AUTH_SECRET || '').trim(),
  users: getAuthUsers()
});

export const isValidCredentials = (username, password) =>
  getAuthUsers().some((u) => u.username === username && u.password === password);

export const getMongoUriForUsername = (username) =>
  getAuthUsers().find((u) => u.username === username)?.mongoUri || null;

export const createSessionToken = (username) =>
  `${AUTH_COOKIE_PREFIX}${encodeURIComponent(String(username || '').trim())}`;

export const getSessionUsername = (token) => {
  const raw = String(token || '');
  if (!raw.startsWith(AUTH_COOKIE_PREFIX)) return null;
  const username = decodeSessionUsername(raw.slice(AUTH_COOKIE_PREFIX.length)).trim();
  if (!username) return null;
  return getAuthUsers().some((u) => u.username === username) ? username : null;
};

export const isAuthConfigured = () => {
  const { users, secret } = getAuthConfig();
  return Boolean(users.length > 0 && secret);
};
