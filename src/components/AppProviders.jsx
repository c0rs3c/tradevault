'use client';

import Layout from './Layout';
import { SettingsProvider } from '../contexts/SettingsContext';

const AppProviders = ({ children }) => {
  return (
    <SettingsProvider>
      <Layout>{children}</Layout>
    </SettingsProvider>
  );
};

export default AppProviders;
