import { randomUUID } from 'crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const MAX_SCREENSHOT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const trimEnv = (value) => String(value || '').trim();

const getR2Config = () => ({
  accountId: trimEnv(process.env.R2_ACCOUNT_ID),
  accessKeyId: trimEnv(process.env.R2_ACCESS_KEY_ID),
  secretAccessKey: trimEnv(process.env.R2_SECRET_ACCESS_KEY),
  bucket: trimEnv(process.env.R2_BUCKET),
  publicBaseUrl: trimEnv(process.env.R2_PUBLIC_BASE_URL).replace(/\/+$/, '')
});

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getMissingConfigFields = (config) =>
  [
    ['R2_ACCOUNT_ID', config.accountId],
    ['R2_ACCESS_KEY_ID', config.accessKeyId],
    ['R2_SECRET_ACCESS_KEY', config.secretAccessKey],
    ['R2_BUCKET', config.bucket],
    ['R2_PUBLIC_BASE_URL', config.publicBaseUrl]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

const getClient = (config) =>
  new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

const inferExtension = (fileName, contentType) => {
  const lowerName = String(fileName || '').toLowerCase();
  if (lowerName.endsWith('.png')) return 'png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'jpg';
  if (lowerName.endsWith('.webp')) return 'webp';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
};

const buildPublicUrl = (config, key) => `${config.publicBaseUrl}/${encodeURI(key)}`;

export const ensureObjectStorageConfigured = () => {
  const config = getR2Config();
  const missingFields = getMissingConfigFields(config);
  if (missingFields.length) {
    throw createError(`Cloudflare R2 is not configured. Missing: ${missingFields.join(', ')}`, 503);
  }
  return config;
};

export const uploadTradeScreenshot = async ({ buffer, contentType, fileName, tradeId = 'draft' }) => {
  const config = ensureObjectStorageConfigured();

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw createError('Screenshot must be a PNG, JPG, or WebP image', 400);
  }

  if (!buffer?.length) {
    throw createError('Screenshot file is empty', 400);
  }

  if (buffer.length > MAX_SCREENSHOT_SIZE_BYTES) {
    throw createError('Screenshot must be 5MB or smaller', 400);
  }

  const extension = inferExtension(fileName, contentType);
  const safeTradeId = String(tradeId || 'draft')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
  const key = `trade-screenshots/${safeTradeId}/${Date.now()}-${randomUUID()}.${extension}`;
  const client = getClient(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    })
  );

  return {
    key,
    url: buildPublicUrl(config, key)
  };
};

export const deleteObjectByKey = async (key) => {
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) return;

  const config = ensureObjectStorageConfigured();
  const client = getClient(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: trimmedKey
    })
  );
};
