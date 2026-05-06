import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { deleteStopLossAdjustment } from '@/lib/server/controllers/trades';

export async function DELETE(_request, { params }) {
  try {
    const { id, sid } = await params;
    await connectDB();
    const trade = await deleteStopLossAdjustment(id, sid);
    return NextResponse.json(trade);
  } catch (error) {
    return handleApiError(error);
  }
}
