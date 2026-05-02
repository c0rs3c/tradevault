import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { AUTH_COOKIE_NAME, getSessionUsername } from '@/lib/auth/session';
import { syncMarketTrendBackfill, syncMarketTrendIncremental } from '@/lib/server/controllers/marketTrend';

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!getSessionUsername(token)) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === 'backfill' ? 'backfill' : 'incremental';
    const result =
      mode === 'backfill' ? await syncMarketTrendBackfill() : await syncMarketTrendIncremental();
    return NextResponse.json({ mode, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
