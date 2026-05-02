import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { syncAllOwnersWatchlistsNews } from '@/lib/server/controllers/news';

const CRON_SECRET = String(process.env.NEWS_SYNC_CRON_SECRET || '').trim();

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export async function POST(request) {
  try {
    const incomingSecret = String(request.headers.get('x-news-sync-secret') || '').trim();
    if (!CRON_SECRET || incomingSecret !== CRON_SECRET) {
      throw createError('Unauthorized', 401);
    }

    const result = await syncAllOwnersWatchlistsNews();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
