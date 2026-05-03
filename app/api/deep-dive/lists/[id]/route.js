import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { requireApiUsername } from '@/lib/auth/apiAuth';
import {
  deleteDeepDiveStockList,
  getDeepDiveStockList,
  updateDeepDiveStockList
} from '@/lib/server/controllers/deepDive';

export async function GET(_request, context) {
  try {
    const ownerUsername = await requireApiUsername();
    const { id } = context.params;
    const result = await getDeepDiveStockList({ ownerUsername, id });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request, context) {
  try {
    const ownerUsername = await requireApiUsername();
    const { id } = context.params;
    const body = await request.json().catch(() => ({}));
    const updated = await updateDeepDiveStockList({
      ownerUsername,
      id,
      title: body?.title,
      description: body?.description,
      text: body?.text
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request, context) {
  try {
    const ownerUsername = await requireApiUsername();
    const { id } = context.params;
    const deleted = await deleteDeepDiveStockList({ ownerUsername, id });
    return NextResponse.json(deleted);
  } catch (error) {
    return handleApiError(error);
  }
}
