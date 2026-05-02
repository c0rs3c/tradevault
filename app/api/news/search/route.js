import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import { searchTickerNews } from '@/lib/server/controllers/news';

export async function GET(request) {
  try {
    await requireApiUsername();
    const symbol = request.nextUrl.searchParams.get('symbol');
    const result = await searchTickerNews({ symbol });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
