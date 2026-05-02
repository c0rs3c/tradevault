import { requireAuth } from '@/lib/auth/guard';

export default async function NewsLayout({ children }) {
  await requireAuth();
  return children;
}
