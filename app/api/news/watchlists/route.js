import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { importTradingViewWatchlist, listWatchlists } from '@/lib/server/controllers/news';

export async function GET() {
  try {
    const ownerUsername = await requireApiUsername();
    const result = await listWatchlists({ ownerUsername });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request) {
  try {
    const ownerUsername = await requireApiUsername();
    const body = await request.json().catch(() => ({}));
    const watchlist = await importTradingViewWatchlist({
      ownerUsername,
      url: body?.url
    });
    return NextResponse.json(watchlist);
  } catch (error) {
    return handleApiError(error);
  }
}
