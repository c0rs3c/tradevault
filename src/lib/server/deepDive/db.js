import mongoose from 'mongoose';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEEP_DIVE_DB_PROVIDER = String(process.env.DEEP_DIVE_DB_PROVIDER || 'mongodb')
  .trim()
  .toLowerCase();
const DEEP_DIVE_MONGO_URI = String(process.env.DEEP_DIVE_MONGO_URI || '').trim();
const DEEP_DIVE_DB_NAME = String(process.env.DEEP_DIVE_DB_NAME || '').trim();
const DEEP_DIVE_FIRESTORE_PROJECT_ID = String(
  process.env.DEEP_DIVE_FIRESTORE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || ''
).trim();
const FIREBASE_SERVICE_ACCOUNT_KEY = String(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();

let cached = global.deepDiveDbState;
if (!cached) {
  cached = global.deepDiveDbState = {
    provider: null,
    mongoConn: null,
    mongoPromise: null,
    mongoUri: null,
    mongoDbName: null,
    firestoreDb: null,
    firestoreProjectId: null,
    firestoreCredentialKey: null
  };
}

const createDeepDiveUnavailableError = (message, cause) => {
  const error = new Error(message);
  error.statusCode = 503;
  if (cause) error.cause = cause;
  return error;
};

const isMongoDnsOrConnectionError = (error) => {
  const message = String(error?.message || '');
  return [
    'querySrv',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEOUT',
    'failed to connect',
    'Server selection timed out'
  ].some((fragment) => message.includes(fragment));
};

const isMongoConnectionUsable = (connection) => {
  const readyState = Number(connection?.readyState);
  return readyState === 1;
};

const isMongoConnectionConnecting = (connection) => {
  const readyState = Number(connection?.readyState);
  return readyState === 2;
};

export const getDeepDiveDbProvider = () => {
  if (!['mongodb', 'firestore'].includes(DEEP_DIVE_DB_PROVIDER)) {
    throw new Error('DEEP_DIVE_DB_PROVIDER must be either "mongodb" or "firestore"');
  }
  return DEEP_DIVE_DB_PROVIDER;
};

const parseServiceAccount = () => {
  if (!FIREBASE_SERVICE_ACCOUNT_KEY) return null;
  try {
    return JSON.parse(FIREBASE_SERVICE_ACCOUNT_KEY);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must be valid JSON');
  }
};

const getOrCreateFirestoreApp = () => {
  const serviceAccount = parseServiceAccount();
  const appName = 'deep-dive-firestore';
  const existing = getApps().find((app) => app.name === appName);
  if (existing) return existing;

  if (serviceAccount) {
    return initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: DEEP_DIVE_FIRESTORE_PROJECT_ID || serviceAccount.project_id
      },
      appName
    );
  }

  return initializeApp(
    {
      projectId: DEEP_DIVE_FIRESTORE_PROJECT_ID || undefined
    },
    appName
  );
};

const connectDeepDiveFirestore = async () => {
  if (!DEEP_DIVE_FIRESTORE_PROJECT_ID && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !FIREBASE_SERVICE_ACCOUNT_KEY) {
    throw new Error(
      'Missing Firestore configuration. Set DEEP_DIVE_FIRESTORE_PROJECT_ID with GOOGLE_APPLICATION_CREDENTIALS, or provide FIREBASE_SERVICE_ACCOUNT_KEY.'
    );
  }

  if (
    cached.firestoreDb &&
    cached.firestoreProjectId === DEEP_DIVE_FIRESTORE_PROJECT_ID &&
    cached.firestoreCredentialKey === FIREBASE_SERVICE_ACCOUNT_KEY
  ) {
    return cached.firestoreDb;
  }

  try {
    const app = getOrCreateFirestoreApp();
    cached.firestoreDb = getFirestore(app);
    cached.firestoreProjectId = DEEP_DIVE_FIRESTORE_PROJECT_ID;
    cached.firestoreCredentialKey = FIREBASE_SERVICE_ACCOUNT_KEY;
    return cached.firestoreDb;
  } catch (error) {
    throw createDeepDiveUnavailableError(
      'Deep Dive data source is unavailable. Check the configured Firestore project and credentials.',
      error
    );
  }
};

const connectDeepDiveMongo = async () => {
  if (!DEEP_DIVE_MONGO_URI) {
    throw new Error('Missing DEEP_DIVE_MONGO_URI environment variable');
  }

  if (
    cached.mongoConn &&
    cached.mongoUri === DEEP_DIVE_MONGO_URI &&
    cached.mongoDbName === DEEP_DIVE_DB_NAME &&
    isMongoConnectionUsable(cached.mongoConn)
  ) {
    return cached.mongoConn;
  }

  if (
    cached.mongoPromise &&
    cached.mongoUri === DEEP_DIVE_MONGO_URI &&
    cached.mongoDbName === DEEP_DIVE_DB_NAME &&
    (isMongoConnectionUsable(cached.mongoConn) || isMongoConnectionConnecting(cached.mongoConn))
  ) {
    cached.mongoConn = await cached.mongoPromise;
    return cached.mongoConn;
  }

  if (cached.mongoConn && !isMongoConnectionUsable(cached.mongoConn) && !isMongoConnectionConnecting(cached.mongoConn)) {
    try {
      await cached.mongoConn.close();
    } catch {
      // Ignore close failures while replacing a stale connection.
    }
    cached.mongoConn = null;
    cached.mongoPromise = null;
  }

  cached.mongoUri = DEEP_DIVE_MONGO_URI;
  cached.mongoDbName = DEEP_DIVE_DB_NAME;
  cached.mongoPromise = mongoose
    .createConnection(DEEP_DIVE_MONGO_URI, DEEP_DIVE_DB_NAME ? { dbName: DEEP_DIVE_DB_NAME } : {})
    .asPromise();

  try {
    cached.mongoConn = await cached.mongoPromise;
    return cached.mongoConn;
  } catch (error) {
    cached.mongoConn = null;
    cached.mongoPromise = null;
    if (isMongoDnsOrConnectionError(error)) {
      throw createDeepDiveUnavailableError(
        'Deep Dive data source is unavailable. Check DEEP_DIVE_MONGO_URI and network access to the configured MongoDB cluster.',
        error
      );
    }
    throw error;
  }
};

export const connectDeepDiveDB = async () => {
  const provider = getDeepDiveDbProvider();
  cached.provider = provider;
  if (provider === 'firestore') return connectDeepDiveFirestore();
  return connectDeepDiveMongo();
};
