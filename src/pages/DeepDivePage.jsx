'use client';

import Link from 'next/link';

const tools = [
  {
    href: '/deep-dive/earnings-shareholding',
    title: 'Earnings and Shareholding Deep Dive',
    description: 'Screen stocks using stored quarterly results and shareholding filters from PostgreSQL.'
  },
  {
    href: '/deep-dive/nse-universe',
    title: 'NSE Universe',
    description:
      'Browse PostgreSQL-backed daily OHLCV history, SMAs, rupee volume, and market-cap snapshots for symbols from nse-universe.csv.'
  },
  {
    href: '/deep-dive/rs',
    title: 'RS Deep Dive',
    description: 'Run relative-strength deep dives against Nifty 50.'
  }
];

export default function DeepDivePage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Deep Dive
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Choose a deep-dive workflow below.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="surface-card group rounded-2xl p-5 transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {tool.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {tool.description}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Open
              </span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
