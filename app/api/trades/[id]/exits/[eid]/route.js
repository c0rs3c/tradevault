import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { deleteExit, updateExit } from '@/lib/server/controllers/trades';

export async function PUT(request, { params }) {
  try {
    const { id, eid } = await params;
    await connectDB();
    const body = await request.json();
    const trade = await updateExit(id, eid, body || {});
    return NextResponse.json(trade);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id, eid } = await params;
    await connectDB();
    const trade = await deleteExit(id, eid);
    return NextResponse.json(trade);
  } catch (error) {
    return handleApiError(error);
  }
}
