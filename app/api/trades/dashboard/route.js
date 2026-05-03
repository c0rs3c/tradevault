import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { getDashboard } from '@/lib/server/controllers/trades';

export async function GET(request) {
  try {
    await connectDB();
    const username = await requireApiUsername();
    const forceRefreshCmp = (new URL(request.url)).searchParams.get('forceRefreshCmp') === '1';
    const dashboard = await getDashboard({ forceRefreshCmp, cacheKey: username });
    return NextResponse.json(dashboard);
  } catch (error) {
    return handleApiError(error);
  }
}
