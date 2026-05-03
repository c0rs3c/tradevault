import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { getDeepDiveRsResults } from '@/lib/server/controllers/deepDive';

export async function POST(request) {
  try {
    const ownerUsername = await requireApiUsername();
    const body = await request.json().catch(() => ({}));
    const result = await getDeepDiveRsResults({ ownerUsername, payload: body });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
