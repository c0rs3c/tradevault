import { requireAuth } from '@/lib/auth/guard';

export default async function SettingsLayout({ children }) {
  await requireAuth();
  return children;
}

