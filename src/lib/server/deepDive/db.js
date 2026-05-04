import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEEP_DIVE_FIRESTORE_PROJECT_ID = String(
  process.env.DEEP_DIVE_FIRESTORE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || ''
).trim();
const FIREBASE_SERVICE_ACCOUNT_KEY = String(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();

let cached = global.deepDiveFirestore;
if (!cached) {
  cached = global.deepDiveFirestore = { db: null, projectId: null, credentialKey: null };
}

const parseServiceAccount = () => {
  if (!FIREBASE_SERVICE_ACCOUNT_KEY) return null;
  try {
    return JSON.parse(FIREBASE_SERVICE_ACCOUNT_KEY);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must be valid JSON');
  }
};

const getOrCreateApp = () => {
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

export const connectDeepDiveDB = async () => {
  if (!DEEP_DIVE_FIRESTORE_PROJECT_ID && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !FIREBASE_SERVICE_ACCOUNT_KEY) {
    throw new Error(
      'Missing Firestore configuration. Set DEEP_DIVE_FIRESTORE_PROJECT_ID with GOOGLE_APPLICATION_CREDENTIALS, or provide FIREBASE_SERVICE_ACCOUNT_KEY.'
    );
  }

  if (
    cached.db &&
    cached.projectId === DEEP_DIVE_FIRESTORE_PROJECT_ID &&
    cached.credentialKey === FIREBASE_SERVICE_ACCOUNT_KEY
  ) {
    return cached.db;
  }

  const app = getOrCreateApp();
  cached.db = getFirestore(app);
  cached.projectId = DEEP_DIVE_FIRESTORE_PROJECT_ID;
  cached.credentialKey = FIREBASE_SERVICE_ACCOUNT_KEY;
  return cached.db;
};
