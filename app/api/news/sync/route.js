import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { syncAllWatchlistsNews } from '@/lib/server/controllers/news';

export async function POST() {
  try {
    const ownerUsername = await requireApiUsername();
    const result = await syncAllWatchlistsNews({
      ownerUsername,
      sources: ['tradingview', 'text']
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
