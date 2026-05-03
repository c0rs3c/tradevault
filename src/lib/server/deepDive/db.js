import mongoose from 'mongoose';

const DEEP_DIVE_MONGO_URI = String(process.env.DEEP_DIVE_MONGO_URI || '').trim();
const DEEP_DIVE_DB_NAME = String(process.env.DEEP_DIVE_DB_NAME || '').trim();

let cached = global.deepDiveMongoose;
if (!cached) {
  cached = global.deepDiveMongoose = { conn: null, promise: null, uri: null, dbName: null };
}

export const connectDeepDiveDB = async () => {
  if (!DEEP_DIVE_MONGO_URI) {
    throw new Error('Missing DEEP_DIVE_MONGO_URI environment variable');
  }

  if (
    cached.conn &&
    cached.uri === DEEP_DIVE_MONGO_URI &&
    cached.dbName === DEEP_DIVE_DB_NAME
  ) {
    return cached.conn;
  }

  if (
    cached.promise &&
    cached.uri === DEEP_DIVE_MONGO_URI &&
    cached.dbName === DEEP_DIVE_DB_NAME
  ) {
    cached.conn = await cached.promise;
    return cached.conn;
  }

  if (!cached.promise) {
    cached.uri = DEEP_DIVE_MONGO_URI;
    cached.dbName = DEEP_DIVE_DB_NAME;
    cached.promise = mongoose
      .createConnection(DEEP_DIVE_MONGO_URI, DEEP_DIVE_DB_NAME ? { dbName: DEEP_DIVE_DB_NAME } : {})
      .asPromise();
  }

  cached.conn = await cached.promise;
  return cached.conn;
};
