import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import {
  importTextWatchlist,
  importTradingViewWatchlist,
  listWatchlists
} from '@/lib/server/controllers/news';

export async function GET() {
  try {
    const ownerUsername = await requireApiUsername();
    const result = await listWatchlists({ ownerUsername, sources: ['tradingview', 'text'] });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request) {
  try {
    const ownerUsername = await requireApiUsername();
    const body = await request.json().catch(() => ({}));
    let watchlist;
    if (body?.text) {
      watchlist = await importTextWatchlist({
        ownerUsername,
        title: body?.title || 'Text Watchlist',
        text: body?.text
      });
    } else {
      watchlist = await importTradingViewWatchlist({
        ownerUsername,
        url: body?.url
      });
    }
    return NextResponse.json(watchlist);
  } catch (error) {
    return handleApiError(error);
  }
}
