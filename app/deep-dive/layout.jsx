import { requireAuth } from '@/lib/auth/guard';

export default async function DeepDiveLayout({ children }) {
  await requireAuth();
  return children;
}
