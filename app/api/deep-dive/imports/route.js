import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { getDeepDiveImportInventory } from '@/lib/server/controllers/deepDive';

export async function GET(request) {
  try {
    const ownerUsername = await requireApiUsername();
    const { searchParams } = new URL(request.url);
    const result = await getDeepDiveImportInventory({
      ownerUsername,
      query: searchParams.get('q') || '',
      page: searchParams.get('page') || 1,
      pageSize: searchParams.get('pageSize') || 100
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
