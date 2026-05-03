import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import {
  createDeepDiveStockList,
  listDeepDiveStockLists
} from '@/lib/server/controllers/deepDive';

export async function GET() {
  try {
    const ownerUsername = await requireApiUsername();
    const result = await listDeepDiveStockLists({ ownerUsername });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request) {
  try {
    const ownerUsername = await requireApiUsername();
    const body = await request.json().catch(() => ({}));
    const created = await createDeepDiveStockList({
      ownerUsername,
      title: body?.title,
      description: body?.description,
      text: body?.text
    });
    return NextResponse.json(created);
  } catch (error) {
    return handleApiError(error);
  }
}
