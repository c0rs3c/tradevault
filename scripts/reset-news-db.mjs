import mongoose from 'mongoose';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.join(process.cwd(), '.env');

if (existsSync(ENV_PATH)) {
  const envLines = readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of envLines) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

const NEWS_MONGO_URI = String(process.env.NEWS_MONGO_URI || '').trim();
const CONFIRM_FLAG = '--confirm';
const TARGET_COLLECTIONS = ['watchlists', 'watchlistnewsmatches', 'newsarticles'];

if (!NEWS_MONGO_URI) {
  console.error('Missing NEWS_MONGO_URI environment variable');
  process.exit(1);
}

if (!process.argv.includes(CONFIRM_FLAG)) {
  console.error(
    `Refusing to delete news data without ${CONFIRM_FLAG}. This script deletes all documents from: ${TARGET_COLLECTIONS.join(', ')}`
  );
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(NEWS_MONGO_URI);

  const db = mongoose.connection.db;
  const summary = {};

  for (const collectionName of TARGET_COLLECTIONS) {
    const collection = db.collection(collectionName);
    const deletedCount = await collection.deleteMany({});
    summary[collectionName] = deletedCount.deletedCount || 0;
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message || String(error));
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
