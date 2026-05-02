import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { syncWatchlistNews } from '@/lib/server/controllers/news';

export async function POST(_request, { params }) {
  try {
    const ownerUsername = await requireApiUsername();
    const resolvedParams = await params;
    const result = await syncWatchlistNews({
      ownerUsername,
      watchlistId: resolvedParams.id
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
