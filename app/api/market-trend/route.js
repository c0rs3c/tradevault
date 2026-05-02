import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { AUTH_COOKIE_NAME, getSessionUsername } from '@/lib/auth/session';
import { getMarketTrendDashboard } from '@/lib/server/controllers/marketTrend';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!getSessionUsername(token)) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const dashboard = await getMarketTrendDashboard();
    return NextResponse.json(dashboard);
  } catch (error) {
    return handleApiError(error);
  }
}
