import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { importEarningsWatchlist, listWatchlists } from '@/lib/server/controllers/news';

const getDefaultEarningsWatchlistTitle = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return `earnings_wl_${formatter.format(new Date())}`;
};

export async function GET() {
  try {
    const ownerUsername = await requireApiUsername();
    const result = await listWatchlists({ ownerUsername, sources: ['earnings'] });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request) {
  try {
    const ownerUsername = await requireApiUsername();
    const body = await request.json().catch(() => ({}));
    const watchlist = await importEarningsWatchlist({
      ownerUsername,
      title: body?.title || getDefaultEarningsWatchlistTitle(),
      text: body?.text
    });
    return NextResponse.json(watchlist);
  } catch (error) {
    return handleApiError(error);
  }
}
