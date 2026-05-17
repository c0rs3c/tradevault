import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import {
  getNseUniverseSnapshot,
  getNseUniverseSyncStatus,
  searchNseUniverseSymbols,
  triggerNseUniverseSync
} from '@/lib/server/controllers/nseUniverse';

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
    const mode = request.nextUrl.searchParams.get('mode');

    if (mode === 'status') {
      const result = await getNseUniverseSyncStatus();
      return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
    }

    if (mode === 'suggestions') {
      const query = request.nextUrl.searchParams.get('q');
      const limit = request.nextUrl.searchParams.get('limit');
      const result = await searchNseUniverseSymbols({ query, limit });
      return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
    }

    const query = request.nextUrl.searchParams.get('q');
    const selectedDate = request.nextUrl.searchParams.get('selectedDate');
    const minMarketCapCr = request.nextUrl.searchParams.get('minMarketCapCr');
    const maxMarketCapCr = request.nextUrl.searchParams.get('maxMarketCapCr');
    const minRupeeVolumeCr = request.nextUrl.searchParams.get('minRupeeVolumeCr');
    const maxRupeeVolumeCr = request.nextUrl.searchParams.get('maxRupeeVolumeCr');
    const page = request.nextUrl.searchParams.get('page');
    const pageSize = request.nextUrl.searchParams.get('pageSize');
    const result = await getNseUniverseSnapshot({
      query,
      selectedDate,
      minMarketCapCr,
      maxMarketCapCr,
      minRupeeVolumeCr,
      maxRupeeVolumeCr,
      page,
      pageSize
    });
    return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request) {
  try {
    await requireApiUsername();
    const body = await request.json().catch(() => ({}));
    const result = await triggerNseUniverseSync({ syncDate: body?.syncDate });
    return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    return handleApiError(error);
  }
}
