import { requireAuth } from '@/lib/auth/guard';

export default async function MarketTrendLayout({ children }) {
  await requireAuth();
  return children;
}
