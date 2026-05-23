import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { getNseUniverseMarketBreadth } from '@/lib/server/controllers/nseUniverse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

export async function GET(request) {
  try {
    await requireApiUsername();
    const selectedDate = request.nextUrl.searchParams.get('selectedDate');
    const beforeDate = request.nextUrl.searchParams.get('beforeDate');
    const limit = request.nextUrl.searchParams.get('limit');
    const result = await getNseUniverseMarketBreadth({ selectedDate, beforeDate, limit });
    return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    return handleApiError(error);
  }
}
