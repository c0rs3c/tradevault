import { requireAuth } from '@/lib/auth/guard';

export default async function TradesLayout({ children }) {
  await requireAuth();
  return children;
}

