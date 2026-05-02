import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { deleteWatchlist, getWatchlistDetails } from '@/lib/server/controllers/news';

export async function GET(_request, { params }) {
  try {
    const ownerUsername = await requireApiUsername();
    const resolvedParams = await params;
    const watchlist = await getWatchlistDetails({
      ownerUsername,
      watchlistId: resolvedParams.id
    });
    return NextResponse.json(watchlist);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request, { params }) {
  try {
    const ownerUsername = await requireApiUsername();
    const resolvedParams = await params;
    const result = await deleteWatchlist({
      ownerUsername,
      watchlistId: resolvedParams.id
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
