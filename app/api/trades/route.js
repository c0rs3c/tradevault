import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { createTrade, getTrades } from '@/lib/server/controllers/trades';

export async function GET() {
  try {
    await connectDB();
    const username = await requireApiUsername();
    const trades = await getTrades({ cacheKey: username });
    return NextResponse.json(trades);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request) {
  try {
    await connectDB();
    const body = await request.json();
    const trade = await createTrade(body || {});
    return NextResponse.json(trade, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
