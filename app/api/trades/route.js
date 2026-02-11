import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { createTrade, getTrades } from '@/lib/server/controllers/trades';

export async function GET() {
  try {
    await connectDB();
    const trades = await getTrades();
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
