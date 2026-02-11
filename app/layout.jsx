import './globals.css';
import AppProviders from '@/components/AppProviders';

export const metadata = {
  title: 'Trade Vault',
  description: 'Trading journal application'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
