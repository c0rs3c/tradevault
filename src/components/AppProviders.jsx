'use client';

import { Suspense } from 'react';
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
      <Suspense fallback={children}>
        <Layout>{children}</Layout>
      </Suspense>
    </SettingsProvider>
  );
};

export default AppProviders;
