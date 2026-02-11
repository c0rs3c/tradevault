import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { importDhanTrades } from '@/lib/server/controllers/trades';

export async function POST(request) {
  try {
    await connectDB();
    const body = await request.json();
    const result = await importDhanTrades(body || {});
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
