import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSettings } from '../contexts/SettingsContext';

const navClass = (isActive) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ${
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
  const { theme, setTheme } = useSettings();
  const router = useRouter();

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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link
            href="/dashboard"
            className="group brand-text flex items-center gap-2.5 transition-colors"
          >
            <img
              src="/trade-vault-logo.svg"
              alt="Trade Vault logo"
              className="h-8 w-8 rounded-lg border border-slate-200/80 shadow-sm dark:border-slate-700/80"
            />
            <span className="text-xl font-semibold tracking-tight">Trade Vault</span>
          </Link>
          <nav className="flex items-center gap-2">
            <NavItem href="/dashboard" label="Dashboard" />
            <NavItem href="/trades" label="Trades" exact />
            <NavItem href="/trades/new" label="New Trade" exact />
            <NavItem href="/trades/import" label="Import Trade" exact />
            <NavItem href="/settings" label="Settings" />
            <button
              type="button"
              onClick={handleThemeToggle}
              className="btn-muted"
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
              className="btn-muted"
              aria-label="Logout"
              title="Logout"
            >
              Logout
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
};

export default Layout;
