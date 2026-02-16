import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { getSymbols } from '@/lib/server/controllers/symbols';

export async function GET() {
  try {
    const result = await getSymbols();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
