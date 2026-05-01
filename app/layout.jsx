import './globals.css';
import AppProviders from '@/components/AppProviders';

const themeInitScript = `
  (() => {
    try {
      const theme = localStorage.getItem('trade-journal-theme') === 'dark' ? 'dark' : 'light';
      const root = document.documentElement;
      root.classList.toggle('dark', theme === 'dark');
      root.style.colorScheme = theme;
    } catch {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }
  })();
`;

export const metadata = {
  title: 'Trade Vault',
  description: 'Trading journal application',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg'
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
