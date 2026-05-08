import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';

const navClass = (isActive) =>
  `shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200 md:px-3 md:py-2 md:text-sm ${
    isActive
      ? 'nav-active shadow-sm'
      : 'text-slate-700 hover:-translate-y-0.5 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`;

const NavItem = ({ href, label, exact = false, activeQuery = null }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathOnly = String(href || '').split('?')[0];
  const pathActive = exact ? pathname === pathOnly : pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
  const queryActive = activeQuery
    ? activeQuery.value === null
      ? !searchParams.get(activeQuery.key)
      : searchParams.get(activeQuery.key) === activeQuery.value
    : true;
  const isActive = pathActive && queryActive;

  return (
    <Link href={href} className={navClass(isActive)}>
      {label}
    </Link>
  );
};

const NavDropdown = ({ label, items }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isActive = items.some(({ href, exact = false, activeQuery = null }) => {
    const pathOnly = String(href || '').split('?')[0];
    const pathMatch = exact ? pathname === pathOnly : pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
    const queryMatch = activeQuery
      ? activeQuery.value === null
        ? !searchParams.get(activeQuery.key)
        : searchParams.get(activeQuery.key) === activeQuery.value
      : true;
    return pathMatch && queryMatch;
  });

  return (
    <div className="group relative">
      <button type="button" className={navClass(isActive)} aria-haspopup="menu">
        <span className="flex items-center gap-1.5">
          <span>{label}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <div className="invisible absolute left-0 top-full z-20 mt-2 min-w-[13rem] translate-y-1 rounded-xl border border-slate-200 bg-white p-1 opacity-0 shadow-xl transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-950">
        {items.map(({ href, label: itemLabel, exact = false, description, activeQuery = null }) => {
          const pathOnly = String(href || '').split('?')[0];
          const pathMatch = exact ? pathname === pathOnly : pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
          const queryMatch = activeQuery
            ? activeQuery.value === null
              ? !searchParams.get(activeQuery.key)
              : searchParams.get(activeQuery.key) === activeQuery.value
            : true;
          const itemActive = pathMatch && queryMatch;
          return (
            <Link
              key={href}
              href={href}
              className={`block rounded-lg px-3 py-2 transition-colors ${
                itemActive
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900'
              }`}
            >
              <div className="text-sm font-medium">{itemLabel}</div>
              {description ? (
                <div className={`mt-0.5 text-xs ${itemActive ? 'text-slate-200 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
                  {description}
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

const Layout = ({ children }) => {
  const pathname = usePathname();
  const { theme, setTheme } = useSettings();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState({ username: '', avatarUrl: '' });
  const [mounted, setMounted] = useState(false);

  const themeToggleLabel = mounted
    ? theme === 'dark'
      ? 'Switch to light mode'
      : 'Switch to dark mode'
    : 'Toggle theme';
  const mobileThemeToggleLabel = mounted ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : 'Toggle Theme';

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let active = true;

    const loadSessionUser = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (active) {
          setSessionUser({
            username: String(data?.username || '').trim(),
            avatarUrl: String(data?.avatarUrl || '').trim()
          });
        }
      } catch {
        // Header label is non-critical.
      }
    };

    loadSessionUser();
    return () => {
      active = false;
    };
  }, []);

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

  const sessionUsername = sessionUser.username;
  const sessionInitial = sessionUsername ? sessionUsername.charAt(0).toUpperCase() : '';
  const tradesMenuItems = [
    { href: '/trades', label: 'All Trades', exact: true, description: 'Review every trade' },
    { href: '/trades/new', label: 'Add New Trade', exact: true, description: 'Create a fresh trade entry' },
    { href: '/trades/exit', label: 'Exit Trade', exact: true, description: 'Search open trades and record an exit' }
  ];
  const toolsMenuItems = [
    { href: '/position-sizing', label: 'Position Sizing', exact: true, description: 'Risk and sizing calculator' },
    {
      href: '/risk-reward-simulator',
      label: 'Risk-Reward Simulator',
      exact: true,
      description: 'Expectancy and annual return simulator'
    },
    { href: '/market-trend', label: 'Market Trend', exact: true, description: 'Trend and breadth dashboard' }
  ];
  const deepDiveMenuItems = [
    { href: '/deep-dive', label: 'Overview', exact: true, description: 'Choose a deep-dive workflow' },
    { href: '/deep-dive/rs', label: 'RS Deep Dive', exact: true, description: 'Relative-strength scanner and ranking' }
  ];
  const settingsMenuItems = [
    {
      href: '/settings',
      label: 'General Settings',
      exact: true,
      activeQuery: { key: 'tab', value: null },
      description: 'App preferences and layout'
    },
    {
      href: '/settings?tab=deepDive',
      label: 'Deep Dive',
      exact: true,
      activeQuery: { key: 'tab', value: 'deepDive' },
      description: 'Universe, imports, and errors'
    },
    {
      href: '/settings?tab=importTrades',
      label: 'Import Trades',
      exact: true,
      activeQuery: { key: 'tab', value: 'importTrades' },
      description: 'Zerodha and Dhan imports'
    }
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/80 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/80">
        <div className="mx-auto max-w-[90rem] px-4 py-3 md:py-4">
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
                <NavDropdown label="Deep Dive" items={deepDiveMenuItems} />
                <NavItem href="/news" label="News" exact />
                <NavDropdown label="Trades" items={tradesMenuItems} />
                <NavDropdown label="Tools" items={toolsMenuItems} />
                <NavDropdown label="Settings" items={settingsMenuItems} />
                {sessionUsername ? (
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-100 text-sm font-semibold uppercase text-slate-700 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-100"
                    title={`Logged in as ${sessionUsername}`}
                  >
                    {sessionUser.avatarUrl ? (
                      <img src={sessionUser.avatarUrl} alt={sessionUsername} className="h-full w-full object-cover" />
                    ) : (
                      sessionInitial
                    )}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={handleThemeToggle}
                  className="btn-muted shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs md:px-3 md:py-2 md:text-sm"
                  aria-label={themeToggleLabel}
                  title={themeToggleLabel}
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
              <div className="space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-slate-800/80">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Deep Dive</p>
                <NavItem href="/deep-dive" label="Overview" exact />
                <NavItem href="/deep-dive/rs" label="RS Deep Dive" exact />
              </div>
              <NavItem href="/news" label="News" exact />
              <div className="space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-slate-800/80">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Trades</p>
                <NavItem href="/trades" label="All Trades" exact />
                <NavItem href="/trades/new" label="Add New Trade" exact />
                <NavItem href="/trades/exit" label="Exit Trade" exact />
              </div>
              <div className="space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-slate-800/80">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tools</p>
                <NavItem href="/position-sizing" label="Position Sizing" exact />
                <NavItem href="/risk-reward-simulator" label="Risk-Reward Simulator" exact />
                <NavItem href="/market-trend" label="Market Trend" exact />
              </div>
              <div className="space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-slate-800/80">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Settings</p>
                <NavItem href="/settings" label="General Settings" exact activeQuery={{ key: 'tab', value: null }} />
                <NavItem href="/settings?tab=deepDive" label="Deep Dive" exact activeQuery={{ key: 'tab', value: 'deepDive' }} />
                <NavItem href="/settings?tab=importTrades" label="Import Trades" exact activeQuery={{ key: 'tab', value: 'importTrades' }} />
              </div>
              {sessionUsername ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700/80 dark:text-slate-200">
                  <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-100 text-sm font-semibold uppercase text-slate-700 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-100">
                    {sessionUser.avatarUrl ? (
                      <img src={sessionUser.avatarUrl} alt={sessionUsername} className="h-full w-full object-cover" />
                    ) : (
                      sessionInitial
                    )}
                  </span>
                  <span>{sessionUsername}</span>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleThemeToggle}
                className="btn-muted w-full shrink-0 whitespace-nowrap px-2.5 py-1.5 text-left text-xs"
                aria-label={themeToggleLabel}
                title={themeToggleLabel}
              >
                {mobileThemeToggleLabel}
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
      <main className="mx-auto max-w-[90rem] px-4 py-6">{children}</main>
    </div>
  );
};

export default Layout;
