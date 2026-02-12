'use client';

import Layout from './Layout';
import { SettingsProvider } from '../contexts/SettingsContext';
import { usePathname } from 'next/navigation';

const AppProviders = ({ children }) => {
  const pathname = usePathname();

  if (pathname === '/login') {
    return children;
  }

  return (
    <SettingsProvider>
      <Layout>{children}</Layout>
    </SettingsProvider>
  );
};

export default AppProviders;
