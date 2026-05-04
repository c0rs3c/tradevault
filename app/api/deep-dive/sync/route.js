import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { triggerDeepDiveSync } from '@/lib/server/controllers/deepDive';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    await requireApiUsername();
    const body = await request.json().catch(() => ({}));
    const result = await triggerDeepDiveSync({ mode: body?.mode });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
