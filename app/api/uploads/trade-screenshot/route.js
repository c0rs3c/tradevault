import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/server/api';
import { deleteObjectByKey, uploadTradeScreenshot } from '@/lib/server/services/objectStorage';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const tradeId = formData.get('tradeId');

    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ message: 'Screenshot file is required' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const uploaded = await uploadTradeScreenshot({
      buffer: Buffer.from(arrayBuffer),
      contentType: file.type,
      fileName: file.name,
      tradeId: typeof tradeId === 'string' ? tradeId : 'draft'
    });

    return NextResponse.json(uploaded, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    await deleteObjectByKey(body?.key);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
