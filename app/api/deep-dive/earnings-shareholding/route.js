import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import {
  getEarningsShareholdingDeepDive,
  listEarningsShareholdingCompanies,
  listEarningsShareholdingPeriods,
  listEarningsShareholdingSummary,
  searchEarningsShareholdingCompanies
} from '@/lib/server/controllers/earningsShareholding';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    await requireApiUsername();
    const mode = request.nextUrl.searchParams.get('mode');
    if (mode === 'summary') {
      const result = await listEarningsShareholdingSummary({
        symbol: request.nextUrl.searchParams.get('symbol'),
        quarters: request.nextUrl.searchParams.get('quarters'),
        minMarketCapCr: request.nextUrl.searchParams.get('minMarketCapCr'),
        maxMarketCapCr: request.nextUrl.searchParams.get('maxMarketCapCr'),
        minRupeeVolumeCr: request.nextUrl.searchParams.get('minRupeeVolumeCr'),
        maxRupeeVolumeCr: request.nextUrl.searchParams.get('maxRupeeVolumeCr'),
        minPrice: request.nextUrl.searchParams.get('minPrice'),
        maxPrice: request.nextUrl.searchParams.get('maxPrice'),
        columnFilters: request.nextUrl.searchParams.get('columnFilters')
      });
      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      });
    }
    if (mode === 'periods') {
      const result = await listEarningsShareholdingPeriods();
      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      });
    }
    if (mode === 'list') {
      const result = await listEarningsShareholdingCompanies();
      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      });
    }
    const query = request.nextUrl.searchParams.get('q');
    if (String(query || '').trim()) {
      const limit = request.nextUrl.searchParams.get('limit');
      const result = await searchEarningsShareholdingCompanies({ query, limit });
      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      });
    }
    const symbol = request.nextUrl.searchParams.get('symbol');
    const result = await getEarningsShareholdingDeepDive({ symbol });
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
