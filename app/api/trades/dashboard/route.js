import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { getDashboard } from '@/lib/server/controllers/trades';

export async function GET() {
  try {
    await connectDB();
    const dashboard = await getDashboard();
    return NextResponse.json(dashboard);
  } catch (error) {
    return handleApiError(error);
  }
}
