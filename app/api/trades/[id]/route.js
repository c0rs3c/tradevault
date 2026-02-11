import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { deleteTrade, getTradeById, updateTrade } from '@/lib/server/controllers/trades';

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    await connectDB();
    const trade = await getTradeById(id);
    return NextResponse.json(trade);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    await connectDB();
    const body = await request.json();
    const trade = await updateTrade(id, body || {});
    return NextResponse.json(trade);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    await connectDB();
    await deleteTrade(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
