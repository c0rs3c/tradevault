import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { getDashboard } from '@/lib/server/controllers/trades';

export async function GET(request) {
  try {
    await connectDB();
    const forceRefreshCmp = (new URL(request.url)).searchParams.get('forceRefreshCmp') === '1';
    const dashboard = await getDashboard({ forceRefreshCmp });
    return NextResponse.json(dashboard);
  } catch (error) {
    return handleApiError(error);
  }
}
