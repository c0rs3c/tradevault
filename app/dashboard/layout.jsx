import { requireAuth } from '@/lib/auth/guard';

export default async function DashboardLayout({ children }) {
  await requireAuth();
  return children;
}

