import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { getTradeImports } from '@/lib/server/controllers/trades';

export async function GET() {
  try {
    await connectDB();
    const imports = await getTradeImports();
    return NextResponse.json(imports);
  } catch (error) {
    return handleApiError(error);
  }
}
