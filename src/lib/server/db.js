import mongoose from 'mongoose';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, getMongoUriForUsername, getSessionUsername } from '@/lib/auth/session';

const DEFAULT_MONGO_URI = String(process.env.MONGO_URI || '').trim();

if (!DEFAULT_MONGO_URI) {
  throw new Error('Missing MONGO_URI environment variable');
}

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null, uri: null };
}

const getMongoUriForCurrentSession = async () => {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    const username = getSessionUsername(token);
    if (!username) return DEFAULT_MONGO_URI;
    return getMongoUriForUsername(username) || DEFAULT_MONGO_URI;
  } catch {
    return DEFAULT_MONGO_URI;
  }
};

export const connectDB = async () => {
  const mongoUri = await getMongoUriForCurrentSession();

  if (cached.conn && cached.uri === mongoUri) return cached.conn;

  if (cached.promise && cached.uri === mongoUri) {
    cached.conn = await cached.promise;
    return cached.conn;
  }

  if (cached.uri && cached.uri !== mongoUri && (cached.conn || cached.promise)) {
    try {
      if (cached.promise) await cached.promise;
    } catch {
      // Ignore failed stale connection attempts before switching URIs.
    }
    await mongoose.disconnect().catch(() => {});
    cached.conn = null;
    cached.promise = null;
    cached.uri = null;
  }

  if (!cached.promise) {
    cached.uri = mongoUri;
    cached.promise = mongoose.connect(mongoUri).then((mongooseInstance) => mongooseInstance);
  }

  cached.conn = await cached.promise;
  return cached.conn;
};
