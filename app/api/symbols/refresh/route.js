import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { refreshSymbolsFromNse } from '@/lib/server/controllers/symbols';

export async function POST() {
  try {
    const result = await refreshSymbolsFromNse();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
