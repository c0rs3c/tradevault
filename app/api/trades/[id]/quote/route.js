import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { getTradeQuote } from '@/lib/server/controllers/trades';

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    await connectDB();
    const quote = await getTradeQuote(id);
    return NextResponse.json(quote);
  } catch (error) {
    return handleApiError(error);
  }
}
