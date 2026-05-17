import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { getSymbolOverview } from '@/lib/server/controllers/symbolProfiles';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    await requireApiUsername();
    const symbol = request.nextUrl.searchParams.get('symbol');
    const result = await getSymbolOverview({ symbol });
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
