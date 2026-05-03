import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { getDeepDiveStatus } from '@/lib/server/controllers/deepDive';

export async function GET() {
  try {
    await requireApiUsername();
    const result = await getDeepDiveStatus();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
