import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { addPyramid } from '@/lib/server/controllers/trades';

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    await connectDB();
    const body = await request.json();
    const trade = await addPyramid(id, body || {});
    return NextResponse.json(trade, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
