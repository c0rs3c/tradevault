import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { deleteTradeImport, getTradeImportById } from '@/lib/server/controllers/trades';

export async function GET(_request, { params }) {
  try {
    const { importId } = await params;
    await connectDB();
    const result = await getTradeImportById(importId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { importId } = await params;
    await connectDB();
    const result = await deleteTradeImport(importId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
