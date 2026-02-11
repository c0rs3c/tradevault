import { NextResponse } from 'next/server';

export const handleApiError = (error) => {
  const status = error?.statusCode || 500;
  return NextResponse.json({ message: error?.message || 'Internal Server Error' }, { status });
};
