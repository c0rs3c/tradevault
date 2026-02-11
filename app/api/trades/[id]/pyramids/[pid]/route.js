import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { deletePyramid, updatePyramid } from '@/lib/server/controllers/trades';

export async function PUT(request, { params }) {
  try {
    const { id, pid } = await params;
    await connectDB();
    const body = await request.json();
    const trade = await updatePyramid(id, pid, body || {});
    return NextResponse.json(trade);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id, pid } = await params;
    await connectDB();
    const trade = await deletePyramid(id, pid);
    return NextResponse.json(trade);
  } catch (error) {
    return handleApiError(error);
  }
}
