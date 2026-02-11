import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/server/db';
import { handleApiError } from '@/lib/server/api';
import { getSettings, updateSettings } from '@/lib/server/controllers/settings';

export async function GET() {
  try {
    await connectDB();
    const settings = await getSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request) {
  try {
    await connectDB();
    const body = await request.json();
    const settings = await updateSettings(body || {});
    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}
