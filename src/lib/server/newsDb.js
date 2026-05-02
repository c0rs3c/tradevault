import mongoose from 'mongoose';

const NEWS_MONGO_URI = String(process.env.NEWS_MONGO_URI || '').trim();

if (!NEWS_MONGO_URI) {
  throw new Error('Missing NEWS_MONGO_URI environment variable');
}

let cached = global.newsMongoose;
if (!cached) {
  cached = global.newsMongoose = { conn: null, promise: null };
}

export const connectNewsDB = async () => {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.createConnection(NEWS_MONGO_URI).asPromise();
  }
  cached.conn = await cached.promise;
  return cached.conn;
};
