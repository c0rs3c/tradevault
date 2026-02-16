import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';

const navClass = (isActive) =>
  `shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200 md:px-3 md:py-2 md:text-sm ${
    isActive
      ? 'nav-active shadow-sm'
      : 'text-slate-700 hover:-translate-y-0.5 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`;

const NavItem = ({ href, label, exact = false }) => {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className={navClass(isActive)}>
      {label}
    </Link>
  );
};

const Layout = ({ children }) => {
  const pathname = usePathname();
  const { theme, setTheme } = useSettings();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleThemeToggle = async () => {
    try {
      await setTheme(theme === 'dark' ? 'light' : 'dark');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to update theme');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/80 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/80">
        <div className="mx-auto max-w-7xl px-4 py-3 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/dashboard"
              className="group brand-text flex items-center gap-2.5 transition-colors md:self-auto"
            >
              <img
                src="/trade-vault-logo.svg"
                alt="Trade Vault logo"
                className="h-8 w-8 rounded-lg border border-slate-200/80 shadow-sm dark:border-slate-700/80"
              />
              <span className="text-xl font-semibold tracking-tight">Trade Vault</span>
            </Link>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className="btn-muted p-2 md:hidden"
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18M3 12h18M3 18h18" />
                  </svg>
                )}
              </button>

              <nav className="hidden items-center gap-2 md:flex">
                <NavItem href="/dashboard" label="Dashboard" />
                <NavItem href="/trades" label="Trades" exact />
                <NavItem href="/trades/new" label="New Trade" exact />
                <NavItem href="/trades/import" label="Import Trade" exact />
                <NavItem href="/settings" label="Settings" />
                <button
                  type="button"
                  onClick={handleThemeToggle}
                  className="btn-muted shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs md:px-3 md:py-2 md:text-sm"
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn-muted shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs md:px-3 md:py-2 md:text-sm"
                  aria-label="Logout"
                  title="Logout"
                >
                  Logout
                </button>
              </nav>
            </div>
          </div>

          {mobileMenuOpen && (
            <nav className="mt-3 flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-800/80 md:hidden">
              <NavItem href="/dashboard" label="Dashboard" />
              <NavItem href="/trades" label="Trades" exact />
              <NavItem href="/trades/new" label="New Trade" exact />
              <NavItem href="/trades/import" label="Import Trade" exact />
              <NavItem href="/settings" label="Settings" />
              <button
                type="button"
                onClick={handleThemeToggle}
                className="btn-muted w-full shrink-0 whitespace-nowrap px-2.5 py-1.5 text-left text-xs"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="btn-muted w-full shrink-0 whitespace-nowrap px-2.5 py-1.5 text-left text-xs"
                aria-label="Logout"
                title="Logout"
              >
                Logout
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
};

export default Layout;
