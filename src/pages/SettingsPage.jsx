import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createDeepDiveList,
  fetchDeepDiveStatus,
  fetchDeepDiveErrors,
  deleteDeepDiveList,
  fetchDeepDiveImports,
  triggerDeepDiveSync
} from '../api/deepDive';
import { saveSettings } from '../api/settings';
import { fetchSymbols, refreshSymbols } from '../api/symbols';
import ImportTradesPage from './ImportTradesPage';
import { useSettings } from '../contexts/SettingsContext';
import { ACCENT_THEMES, DEFAULT_ACCENT } from '../utils/appearance';

const numberFormatter = new Intl.NumberFormat('en-IN');
const decimalFormatter2 = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const formatTablePrice = (value) => (value === null || value === undefined ? '-' : decimalFormatter2.format(Number(value)));
const LoadingSpinner = ({ label = 'Loading...' }) => (
  <div className="flex items-center justify-center gap-3 py-8 text-sm text-slate-600 dark:text-slate-300">
    <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-slate-700 dark:border-t-slate-100" />
    <span>{label}</span>
  </div>
);

const buildPageNumbers = (currentPage, totalPages) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }

  return [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
};

const normalizeSearchText = (value) => String(value || '').trim().toUpperCase();
const shiftDateInput = (value, deltaDays) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return raw;
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
};
const matchesFuzzy = (candidate, query) => {
  const source = normalizeSearchText(candidate);
  const needle = normalizeSearchText(query);
  if (!needle) return null;
  if (source === needle) return 1000;
  if (source.startsWith(needle)) return 750 - (source.length - needle.length);
  if (source.includes(needle)) return 500 - source.indexOf(needle);
  let queryIndex = 0;
  let gaps = 0;
  for (let index = 0; index < source.length && queryIndex < needle.length; index += 1) {
    if (source[index] === needle[queryIndex]) queryIndex += 1;
    else gaps += 1;
  }
  return queryIndex === needle.length ? 250 - gaps : null;
};

const SettingsPage = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { settings, refreshSettings, loading } = useSettings();
  const [activeTab, setActiveTab] = useState('general');
  const [totalCapital, setTotalCapital] = useState('');
  const [defaultRiskPercent, setDefaultRiskPercent] = useState('');
  const [theme, setTheme] = useState('light');
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [dashboardCards, setDashboardCards] = useState({
    totalRealizedPnl: true,
    monthlyPnl: true,
    totalCapitalAtRisk: true,
    totalPositionSize: true,
    totalUnrealizedPnl: true,
    avgR: false,
    avgHoldingDays: true,
    winRate: true,
    avgWinnerLoser: true,
    profitFactor: false,
    maxDrawdown: false,
    tradesOpenCount: true
  });
  const [chartDefaultTimeframe, setChartDefaultTimeframe] = useState('1D');
  const [smaPeriods, setSmaPeriods] = useState(['10', '20', '50']);
  const [smaColors, setSmaColors] = useState(['#2563eb', '#f59e0b', '#16a34a']);
  const [smaLineWidth, setSmaLineWidth] = useState('thin');
  const [smaScaleLabelsVisible, setSmaScaleLabelsVisible] = useState(false);
  const [entryArrowColor, setEntryArrowColor] = useState('#000000');
  const [exitArrowColor, setExitArrowColor] = useState('#2563eb');
  const [entryArrowSize, setEntryArrowSize] = useState('1');
  const [exitArrowSize, setExitArrowSize] = useState('1');
  const [entryLabelColor, setEntryLabelColor] = useState('#000000');
  const [exitLabelColor, setExitLabelColor] = useState('#000000');
  const [labelFontFamily, setLabelFontFamily] = useState('Trebuchet MS, Roboto, sans-serif');
  const [labelFontSize, setLabelFontSize] = useState('12');
  const [purpleDotVisible, setPurpleDotVisible] = useState(true);
  const [purpleDotLeftPaneVisible, setPurpleDotLeftPaneVisible] = useState(true);
  const [purpleDotRightPaneVisible, setPurpleDotRightPaneVisible] = useState(true);
  const [purpleDotCombineConditions, setPurpleDotCombineConditions] = useState(true);
  const [purpleDotVolumeAbove, setPurpleDotVolumeAbove] = useState('1000000');
  const [purpleDotPercentThreshold, setPurpleDotPercentThreshold] = useState('5');
  const [purpleDotColor, setPurpleDotColor] = useState('#a855f7');
  const [purpleDotSize, setPurpleDotSize] = useState('1');
  const [purpleDotPosition, setPurpleDotPosition] = useState('belowBar');
  const [symbolsCount, setSymbolsCount] = useState(0);
  const [symbolsUpdatedAt, setSymbolsUpdatedAt] = useState('');
  const [allMarketSymbols, setAllMarketSymbols] = useState([]);
  const [refreshingSymbols, setRefreshingSymbols] = useState(false);
  const [deepDiveImports, setDeepDiveImports] = useState(null);
  const [deepDiveImportsLoading, setDeepDiveImportsLoading] = useState(false);
  const [deepDiveSection, setDeepDiveSection] = useState('stocks');
  const [deepDiveSyncing, setDeepDiveSyncing] = useState(false);
  const [deepDiveSyncProgress, setDeepDiveSyncProgress] = useState(null);
  const [createDeepDiveTitle, setCreateDeepDiveTitle] = useState('');
  const [createDeepDiveDescription, setCreateDeepDiveDescription] = useState('');
  const [createDeepDiveText, setCreateDeepDiveText] = useState('');
  const [creatingDeepDiveList, setCreatingDeepDiveList] = useState(false);
  const [addingDeepDiveSymbol, setAddingDeepDiveSymbol] = useState(false);
  const [deletingDeepDiveListId, setDeletingDeepDiveListId] = useState('');
  const [deepDiveSearch, setDeepDiveSearch] = useState('');
  const [deepDivePage, setDeepDivePage] = useState(1);
  const [deepDiveAsOfDate, setDeepDiveAsOfDate] = useState('');
  const [deepDiveErrors, setDeepDiveErrors] = useState(null);
  const [deepDiveErrorsLoading, setDeepDiveErrorsLoading] = useState(false);
  const [deepDiveErrorSearch, setDeepDiveErrorSearch] = useState('');
  const [deepDiveErrorPage, setDeepDiveErrorPage] = useState(1);
  const [deepDiveLoadError, setDeepDiveLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'deepDive' || tab === 'importTrades') {
      setActiveTab(tab);
      return;
    }
    setActiveTab('general');
  }, [searchParams]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams.toString());
    if (tab === 'general') next.delete('tab');
    else next.set('tab', tab);
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  };

  useEffect(() => {
    if (!settings) return;
    setTotalCapital(settings.totalCapital ?? 0);
    setDefaultRiskPercent(settings.defaultRiskPercent ?? '');
    setTheme(settings.theme === 'light' ? 'light' : 'dark');
    setAccentColor(ACCENT_THEMES[settings.accentColor] ? settings.accentColor : DEFAULT_ACCENT);
    setDashboardCards({
      totalRealizedPnl: settings?.dashboardCards?.totalRealizedPnl ?? true,
      monthlyPnl: settings?.dashboardCards?.monthlyPnl ?? true,
      totalCapitalAtRisk: settings?.dashboardCards?.totalCapitalAtRisk ?? true,
      totalPositionSize: settings?.dashboardCards?.totalPositionSize ?? true,
      totalUnrealizedPnl: settings?.dashboardCards?.totalUnrealizedPnl ?? true,
      avgR: settings?.dashboardCards?.avgR ?? false,
      avgHoldingDays: settings?.dashboardCards?.avgHoldingDays ?? true,
      winRate: settings?.dashboardCards?.winRate ?? true,
      avgWinnerLoser: settings?.dashboardCards?.avgWinnerLoser ?? true,
      profitFactor: settings?.dashboardCards?.profitFactor ?? false,
      maxDrawdown: settings?.dashboardCards?.maxDrawdown ?? false,
      tradesOpenCount: settings?.dashboardCards?.tradesOpenCount ?? true
    });
    const tf = settings?.chartSettings?.defaultTimeframe;
    setChartDefaultTimeframe(['30m', '1h', '1D', '1W'].includes(tf) ? tf : '1D');
    const nextPeriods = [...(settings?.chartSettings?.smaPeriods || [10, 20, 50])].slice(0, 3);
    while (nextPeriods.length < 3) nextPeriods.push([10, 20, 50][nextPeriods.length]);
    setSmaPeriods(nextPeriods.map((v) => String(v)));
    const nextColors = [...(settings?.chartSettings?.smaColors || ['#2563eb', '#f59e0b', '#16a34a'])].slice(0, 3);
    while (nextColors.length < 3) nextColors.push(['#2563eb', '#f59e0b', '#16a34a'][nextColors.length]);
    setSmaColors(nextColors);
    const width = settings?.chartSettings?.smaLineWidth;
    setSmaLineWidth(['thin', 'medium', 'thick'].includes(width) ? width : 'thin');
    setSmaScaleLabelsVisible(Boolean(settings?.chartSettings?.smaScaleLabelsVisible));
    const marker = settings?.chartSettings?.markerSettings || {};
    setEntryArrowColor(marker.entryArrowColor || '#000000');
    setExitArrowColor(marker.exitArrowColor || '#2563eb');
    setEntryArrowSize(String(marker.entryArrowSize ?? 1));
    setExitArrowSize(String(marker.exitArrowSize ?? 1));
    setEntryLabelColor(marker.entryLabelColor || '#000000');
    setExitLabelColor(marker.exitLabelColor || '#000000');
    setLabelFontFamily(marker.labelFontFamily || 'Trebuchet MS, Roboto, sans-serif');
    setLabelFontSize(String(marker.labelFontSize ?? 12));
    const purpleDot = settings?.chartSettings?.purpleDotVolumeSettings || {};
    setPurpleDotVisible(purpleDot.visible ?? true);
    setPurpleDotLeftPaneVisible(purpleDot.leftPaneVisible ?? true);
    setPurpleDotRightPaneVisible(purpleDot.rightPaneVisible ?? true);
    setPurpleDotCombineConditions(purpleDot.combineConditions ?? true);
    setPurpleDotVolumeAbove(String(purpleDot.volumeAbove ?? 1000000));
    setPurpleDotPercentThreshold(String(purpleDot.percentThreshold ?? 5));
    setPurpleDotColor(purpleDot.color || '#a855f7');
    setPurpleDotSize(String(purpleDot.size ?? 1));
    setPurpleDotPosition(purpleDot.position === 'aboveBar' ? 'aboveBar' : 'belowBar');
  }, [settings]);

  useEffect(() => {
    const loadSymbolsMeta = async () => {
      try {
        const data = await fetchSymbols();
        setSymbolsCount(Number(data?.count || 0));
        setSymbolsUpdatedAt(data?.updatedAt || '');
        setAllMarketSymbols(Array.isArray(data?.symbols) ? data.symbols : []);
      } catch {
        setSymbolsCount(0);
        setSymbolsUpdatedAt('');
        setAllMarketSymbols([]);
      }
    };
    loadSymbolsMeta();
  }, []);

  const loadDeepDiveImports = async ({ query = deepDiveSearch, page = deepDivePage, asOfDate = deepDiveAsOfDate } = {}) => {
    setDeepDiveImportsLoading(true);
    try {
      const data = await fetchDeepDiveImports({ q: query, page, pageSize: 100, asOfDate });
      setDeepDiveImports(data);
      setDeepDiveLoadError('');
    } catch (error) {
      setDeepDiveImports(null);
      setDeepDiveLoadError(error.response?.data?.message || 'Failed to load Deep Dive imports');
    } finally {
      setDeepDiveImportsLoading(false);
    }
  };

  const loadDeepDiveErrors = async ({ query = deepDiveErrorSearch, page = deepDiveErrorPage } = {}) => {
    setDeepDiveErrorsLoading(true);
    try {
      const data = await fetchDeepDiveErrors({ q: query, page, pageSize: 100 });
      setDeepDiveErrors(data);
      setDeepDiveLoadError('');
    } catch (error) {
      setDeepDiveErrors(null);
      setDeepDiveLoadError(error.response?.data?.message || 'Failed to load Deep Dive errors');
    } finally {
      setDeepDiveErrorsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'deepDive') return;
    const timer = setTimeout(() => {
      if (deepDiveSection === 'errors') loadDeepDiveErrors();
      else loadDeepDiveImports();
    }, 250);
    return () => clearTimeout(timer);
  }, [activeTab, deepDiveSection, deepDiveSearch, deepDivePage, deepDiveAsOfDate, deepDiveErrorSearch, deepDiveErrorPage]);

  const handleRefreshSymbols = async () => {
    setRefreshingSymbols(true);
    try {
      const data = await refreshSymbols();
      setSymbolsCount(Number(data?.count || 0));
      setSymbolsUpdatedAt(data?.updatedAt || '');
      setAllMarketSymbols(Array.isArray(data?.symbols) ? data.symbols : []);
      alert('Latest NSE symbol CSV downloaded successfully.');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to download NSE symbol CSV');
    } finally {
      setRefreshingSymbols(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (Number(totalCapital) < 0) return alert('Total capital cannot be negative');

    setSaving(true);
    try {
      await saveSettings({
        totalCapital: Number(totalCapital),
        defaultRiskPercent: defaultRiskPercent === '' ? null : Number(defaultRiskPercent),
        theme,
        accentColor,
        dashboardCards,
        chartSettings: {
          defaultTimeframe: chartDefaultTimeframe,
          smaPeriods: smaPeriods.map((value, index) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) return [10, 20, 50][index];
            return Math.round(parsed);
          }),
          smaColors,
          smaLineWidth,
          smaScaleLabelsVisible,
          markerSettings: {
            entryArrowColor,
            exitArrowColor,
            entryArrowSize: Number(entryArrowSize) || 1,
            exitArrowSize: Number(exitArrowSize) || 1,
            entryLabelColor,
            exitLabelColor,
            labelFontFamily,
            labelFontSize: Number(labelFontSize) || 12
          },
          purpleDotVolumeSettings: {
            visible: purpleDotVisible,
            leftPaneVisible: purpleDotLeftPaneVisible,
            rightPaneVisible: purpleDotRightPaneVisible,
            combineConditions: purpleDotCombineConditions,
            volumeAbove: Math.max(0, Number(purpleDotVolumeAbove) || 0),
            percentThreshold: Math.max(0, Number(purpleDotPercentThreshold) || 0),
            color: purpleDotColor,
            size: Number(purpleDotSize) || 1,
            position: purpleDotPosition === 'aboveBar' ? 'aboveBar' : 'belowBar'
          }
        }
      });
      await refreshSettings();
      alert('Settings saved');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDeepDiveList = async (event) => {
    event.preventDefault();
    setCreatingDeepDiveList(true);
    try {
      await createDeepDiveList({
        title: createDeepDiveTitle || 'Deep Dive Universe',
        description: createDeepDiveDescription,
        text: createDeepDiveText
      });
      setCreateDeepDiveTitle('');
      setCreateDeepDiveDescription('');
      setCreateDeepDiveText('');
      setDeepDivePage(1);
      await loadDeepDiveImports({ query: '', page: 1 });
      alert('Deep Dive list created');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to create Deep Dive list');
    } finally {
      setCreatingDeepDiveList(false);
    }
  };

  const handleDeleteDeepDiveList = async (id, title) => {
    const confirmed = window.confirm(`Delete "${title}"?`);
    if (!confirmed) return;
    setDeletingDeepDiveListId(id);
    try {
      await deleteDeepDiveList(id);
      await loadDeepDiveImports();
      alert('Deep Dive list deleted');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to delete Deep Dive list');
    } finally {
      setDeletingDeepDiveListId('');
    }
  };

  const handleAddDeepDiveSymbol = async (symbol) => {
    const normalized = normalizeSearchText(symbol);
    if (!normalized) return;
    setAddingDeepDiveSymbol(true);
    try {
      await createDeepDiveList({
        title: 'Deep Dive Universe',
        description: '',
        text: normalized
      });
      await triggerDeepDiveSync({ mode: 'sync_prices' });
      setCreateDeepDiveText('');
      setDeepDiveSearch(normalized);
      setDeepDivePage(1);
      await loadDeepDiveImports({ query: normalized, page: 1 });
      await loadDeepDiveErrors({ query: '', page: 1 });
      alert(`Added ${normalized} and fetched latest Deep Dive price data`);
    } catch (error) {
      alert(error.response?.data?.message || error.message || `Failed to add ${normalized}`);
    } finally {
      setAddingDeepDiveSymbol(false);
    }
  };

  const handleDeepDiveSync = async () => {
    setDeepDiveSyncing(true);
    setDeepDiveSyncProgress({
      status: 'running',
      current: 0,
      total: 0,
      currentSymbol: '',
      message: 'Starting Deep Dive price sync...'
    });
    let progressTimer = null;
    try {
      const refreshProgress = async () => {
        try {
          const status = await fetchDeepDiveStatus();
          setDeepDiveSyncProgress(status?.activeSync || null);
        } catch {
          // Progress display is non-critical.
        }
      };

      await refreshProgress();
      progressTimer = setInterval(refreshProgress, 1000);

      const result = await triggerDeepDiveSync({ mode: 'sync_prices' });
      await loadDeepDiveImports();
      await loadDeepDiveErrors({ query: '', page: 1 });
      const summary = result?.summary;
      if (summary) {
        alert(
          `Deep Dive price sync finished. Attempted: ${summary.symbolsAttempted || 0}, succeeded: ${summary.symbolsSucceeded || 0}, rows: ${summary.rowsUpserted || 0}.`
        );
      } else {
        alert('Deep Dive price sync finished');
      }
    } catch (error) {
      alert(error.response?.data?.message || error.message || 'Failed to sync Deep Dive data');
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      try {
        const status = await fetchDeepDiveStatus();
        setDeepDiveSyncProgress(status?.activeSync || null);
      } catch {
        setDeepDiveSyncProgress(null);
      }
      setDeepDiveSyncing(false);
    }
  };

  if (loading) return <p>Loading settings...</p>;

  const normalizedDeepDiveSearch = normalizeSearchText(deepDiveSearch);
  const marketSearchCandidates = normalizedDeepDiveSearch
    ? allMarketSymbols
        .filter((symbol) => !Array.isArray(deepDiveImports?.stocks) || !deepDiveImports.stocks.some((item) => item.symbol === symbol))
        .map((symbol) => ({ symbol, score: matchesFuzzy(symbol, normalizedDeepDiveSearch) }))
        .filter((item) => item.score !== null)
        .sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol))
        .slice(0, 8)
        .map((item) => item.symbol)
    : [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleTabChange('general')}
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            activeTab === 'general'
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
          }`}
        >
          General
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('deepDive')}
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            activeTab === 'deepDive'
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
          }`}
        >
          Deep Dive
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('importTrades')}
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            activeTab === 'importTrades'
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
          }`}
        >
          Import Trades
        </button>
      </div>

      {activeTab === 'importTrades' ? (
        <section className="surface-card p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Import Trades</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Upload Zerodha or Dhan tradebooks and review prior imports from the same settings area.
            </p>
          </div>
          <ImportTradesPage embedded />
        </section>
      ) : null}

      {activeTab === 'deepDive' ? (
        <div className="space-y-4">
          <section className="surface-card p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Deep Dive Imports</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Search imported symbols, inspect only the current page, and add a missing stock directly into the Deep Dive universe.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDeepDiveSync}
                disabled={deepDiveSyncing}
                className="btn-primary px-4 py-2 text-sm disabled:cursor-wait disabled:opacity-60"
              >
                {deepDiveSyncing ? 'Fetching Latest Data...' : 'Fetch Latest Data'}
              </button>
            </div>

            {deepDiveSyncProgress ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">
                    Progress: {numberFormatter.format(Number(deepDiveSyncProgress.current || 0))}
                    {deepDiveSyncProgress.total ? `/${numberFormatter.format(Number(deepDiveSyncProgress.total || 0))}` : ''}
                  </span>
                  {deepDiveSyncProgress.currentSymbol ? <span>Symbol: {deepDiveSyncProgress.currentSymbol}</span> : null}
                  {deepDiveSyncProgress.currentBatch && deepDiveSyncProgress.totalBatches ? (
                    <span>
                      Batch: {deepDiveSyncProgress.currentBatch}/{deepDiveSyncProgress.totalBatches}
                    </span>
                  ) : null}
                  <span className="capitalize text-slate-500 dark:text-slate-400">{deepDiveSyncProgress.status}</span>
                </div>
                {deepDiveSyncProgress.message ? (
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{deepDiveSyncProgress.message}</div>
                ) : null}
              </div>
            ) : null}

            {deepDiveLoadError ? (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-200">
                {deepDiveLoadError}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Lists</div>
                <div className="mt-1 font-medium">{numberFormatter.format(deepDiveImports?.summary?.totalLists || 0)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Imported Stocks</div>
                <div className="mt-1 font-medium">{numberFormatter.format(deepDiveImports?.summary?.totalSymbols || 0)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Latest Data Date</div>
                <div className="mt-1 font-medium">{deepDiveImports?.summary?.latestAvailableDate || 'Not available'}</div>
              </div>
            </div>

            {deepDiveImports?.latestRun ? (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                Last sync: {new Date(deepDiveImports.latestRun.finishedAt || deepDiveImports.latestRun.startedAt).toLocaleString()} | Attempted {numberFormatter.format(deepDiveImports.latestRun.symbolsAttempted || 0)} | Succeeded {numberFormatter.format(deepDiveImports.latestRun.symbolsSucceeded || 0)} | Rows {numberFormatter.format(deepDiveImports.latestRun.rowsUpserted || 0)}
              </p>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2">
            {[
              ['stocks', 'Imported Stocks'],
              ['universe', 'Edit Universe'],
              ['errors', 'Errors']
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDeepDiveSection(key)}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  deepDiveSection === key
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {deepDiveSection === 'universe' ? (
            <form onSubmit={handleCreateDeepDiveList} className="surface-card space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Deep Dive Universe</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  There is only one universe. Adding symbols merges them into the same imported stock set.
                </p>
              </div>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Universe Name</span>
                <input
                  value={createDeepDiveTitle}
                  onChange={(event) => setCreateDeepDiveTitle(event.target.value)}
                  className="field-input"
                  placeholder="Deep Dive Universe"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Description</span>
                <input
                  value={createDeepDiveDescription}
                  onChange={(event) => setCreateDeepDiveDescription(event.target.value)}
                  className="field-input"
                  placeholder="Optional notes"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Symbols</span>
                <textarea
                  value={createDeepDiveText}
                  onChange={(event) => setCreateDeepDiveText(event.target.value)}
                  rows={8}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
                  placeholder={'RELIANCE\nTCS\nINFY'}
                />
              </label>
              <button type="submit" className="btn-primary px-4 py-2 text-sm" disabled={creatingDeepDiveList}>
                {creatingDeepDiveList ? 'Saving...' : 'Add Symbols To Universe'}
              </button>

              <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                {(deepDiveImports?.lists || []).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                    <div>
                      <div className="font-medium">{item.title}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {numberFormatter.format(item.symbolCount || 0)} symbols
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteDeepDiveList(item.id, item.title)}
                      disabled={deletingDeepDiveListId === item.id}
                      className="btn-danger px-3 py-1.5 text-sm"
                    >
                      {deletingDeepDiveListId === item.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                ))}
                {!deepDiveImports?.lists?.length && !deepDiveImportsLoading ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No Deep Dive universe yet.</p>
                ) : null}
              </div>
            </form>
          ) : null}

          {deepDiveSection === 'stocks' ? (
            <section className="surface-card space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Imported Stocks</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Search uses fuzzy matching. Only the current page of 100 stocks is loaded, so this section should appear much faster.
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem_auto]">
                <label className="space-y-1">
                  <span className="text-sm font-medium">Search Imported Stock</span>
                  <input
                    value={deepDiveSearch}
                    onChange={(event) => {
                      setDeepDiveSearch(event.target.value);
                      setDeepDivePage(1);
                    }}
                    className="field-input"
                    placeholder="Type symbol like RELIANCE or INF"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium">Table Date</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = shiftDateInput(deepDiveAsOfDate || deepDiveImports?.summary?.latestAvailableDate, -1);
                        setDeepDiveAsOfDate(next);
                        setDeepDivePage(1);
                      }}
                      className="btn-muted px-3 py-2 text-sm"
                      aria-label="Previous day"
                    >
                      ↓
                    </button>
                    <input
                      type="date"
                      value={deepDiveAsOfDate}
                      max={deepDiveImports?.summary?.latestAvailableDate || undefined}
                      onChange={(event) => {
                        setDeepDiveAsOfDate(event.target.value);
                        setDeepDivePage(1);
                      }}
                      className="field-input"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const candidate = shiftDateInput(deepDiveAsOfDate, 1);
                        const maxDate = deepDiveImports?.summary?.latestAvailableDate || '';
                        const next = candidate && maxDate && candidate > maxDate ? maxDate : candidate;
                        setDeepDiveAsOfDate(next);
                        setDeepDivePage(1);
                      }}
                      className="btn-muted px-3 py-2 text-sm"
                      aria-label="Next day"
                    >
                      ↑
                    </button>
                  </div>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setDeepDiveSearch('');
                      setDeepDiveAsOfDate('');
                      setDeepDivePage(1);
                    }}
                    className="btn-muted px-3 py-2 text-sm"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  Page {deepDiveImports?.page || 1} of {deepDiveImports?.totalPages || 1} | Matches {numberFormatter.format(deepDiveImports?.totalMatches || 0)} of {numberFormatter.format(deepDiveImports?.summary?.totalSymbols || 0)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDeepDivePage((current) => Math.max(1, current - 1))}
                    disabled={deepDiveImportsLoading || (deepDiveImports?.page || 1) <= 1}
                    className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ← Previous
                  </button>
                  {buildPageNumbers(deepDiveImports?.page || 1, deepDiveImports?.totalPages || 1).map((pageNumber, index, pages) => (
                    <span key={pageNumber} className="flex items-center gap-2">
                      {index > 0 && pageNumber - pages[index - 1] > 1 ? (
                        <span className="text-slate-400">…</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setDeepDivePage(pageNumber)}
                        disabled={deepDiveImportsLoading}
                        className={`rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                          (deepDiveImports?.page || 1) === pageNumber
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        {pageNumber}
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDeepDivePage((current) => Math.min(deepDiveImports?.totalPages || 1, current + 1))}
                    disabled={deepDiveImportsLoading || (deepDiveImports?.page || 1) >= (deepDiveImports?.totalPages || 1)}
                    className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next →
                  </button>
                </div>
              </div>

              {normalizedDeepDiveSearch && !deepDiveImportsLoading && (deepDiveImports?.totalMatches || 0) === 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/20">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    {normalizedDeepDiveSearch} is not in the imported Deep Dive universe.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddDeepDiveSymbol(normalizedDeepDiveSearch)}
                      disabled={addingDeepDiveSymbol}
                      className="btn-primary px-3 py-1.5 text-sm disabled:cursor-wait disabled:opacity-60"
                    >
                      {addingDeepDiveSymbol ? 'Adding...' : `Add ${normalizedDeepDiveSearch}`}
                    </button>
                    {marketSearchCandidates.map((symbol) => (
                      <button
                        key={symbol}
                        type="button"
                        onClick={() => handleAddDeepDiveSymbol(symbol)}
                        disabled={addingDeepDiveSymbol}
                        className="btn-muted px-3 py-1.5 text-sm"
                      >
                        Add {symbol}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {deepDiveImportsLoading ? (
                <LoadingSpinner label="Loading imported stocks..." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1300px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                        <th className="px-3 py-2">Symbol</th>
                        <th className="px-3 py-2">Company</th>
                        <th className="px-3 py-2">{deepDiveAsOfDate ? 'Selected Date' : 'Latest Date'}</th>
                        <th className="px-3 py-2">Open</th>
                        <th className="px-3 py-2">High</th>
                        <th className="px-3 py-2">Low</th>
                        <th className="px-3 py-2">Close</th>
                        <th className="px-3 py-2">Volume</th>
                        <th className="px-3 py-2">Bars</th>
                        <th className="px-3 py-2">Approx Years</th>
                        <th className="px-3 py-2">Sector</th>
                        <th className="px-3 py-2">Industry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deepDiveImports?.benchmarkRow ? (
                        <tr key={deepDiveImports.benchmarkRow.symbol} className="border-b border-slate-200 bg-amber-50/60 dark:border-slate-800 dark:bg-amber-950/10">
                          <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{deepDiveImports.benchmarkRow.symbol}</td>
                          <td className="px-3 py-2">{deepDiveImports.benchmarkRow.companyName || '-'}</td>
                          <td className="px-3 py-2">{deepDiveImports.benchmarkRow.latestDate || '-'}</td>
                          <td className="px-3 py-2">{formatTablePrice(deepDiveImports.benchmarkRow.latestOpen)}</td>
                          <td className="px-3 py-2">{formatTablePrice(deepDiveImports.benchmarkRow.latestHigh)}</td>
                          <td className="px-3 py-2">{formatTablePrice(deepDiveImports.benchmarkRow.latestLow)}</td>
                          <td className="px-3 py-2">{formatTablePrice(deepDiveImports.benchmarkRow.latestClose)}</td>
                          <td className="px-3 py-2">{deepDiveImports.benchmarkRow.latestVolume ? numberFormatter.format(deepDiveImports.benchmarkRow.latestVolume) : '-'}</td>
                          <td className="px-3 py-2">{numberFormatter.format(deepDiveImports.benchmarkRow.barsCount || 0)}</td>
                          <td className="px-3 py-2">{deepDiveImports.benchmarkRow.approxYears ?? '-'}</td>
                          <td className="px-3 py-2">{deepDiveImports.benchmarkRow.sector || '-'}</td>
                          <td className="px-3 py-2">{deepDiveImports.benchmarkRow.industry || '-'}</td>
                        </tr>
                      ) : null}
                      {(deepDiveImports?.stocks || []).map((item) => (
                        <tr key={item.symbol} className="table-row-hover">
                          <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{item.symbol}</td>
                          <td className="px-3 py-2">{item.companyName || '-'}</td>
                          <td className="px-3 py-2">{item.latestDate || '-'}</td>
                          <td className="px-3 py-2">{formatTablePrice(item.latestOpen)}</td>
                          <td className="px-3 py-2">{formatTablePrice(item.latestHigh)}</td>
                          <td className="px-3 py-2">{formatTablePrice(item.latestLow)}</td>
                          <td className="px-3 py-2">{formatTablePrice(item.latestClose)}</td>
                          <td className="px-3 py-2">{item.latestVolume ? numberFormatter.format(item.latestVolume) : '-'}</td>
                          <td className="px-3 py-2">{numberFormatter.format(item.barsCount || 0)}</td>
                          <td className="px-3 py-2">{item.approxYears ?? '-'}</td>
                          <td className="px-3 py-2">{item.sector || '-'}</td>
                          <td className="px-3 py-2">{item.industry || '-'}</td>
                        </tr>
                      ))}
                      {!deepDiveImports?.stocks?.length ? (
                        <tr>
                          <td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                            No stocks found for this search.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
                <p>
                  Page {deepDiveImports?.page || 1} of {deepDiveImports?.totalPages || 1}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDeepDivePage((current) => Math.max(1, current - 1))}
                    disabled={deepDiveImportsLoading || (deepDiveImports?.page || 1) <= 1}
                    className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ←
                  </button>
                  {buildPageNumbers(deepDiveImports?.page || 1, deepDiveImports?.totalPages || 1).map((pageNumber, index, pages) => (
                    <span key={`bottom-imports-${pageNumber}`} className="flex items-center gap-2">
                      {index > 0 && pageNumber - pages[index - 1] > 1 ? (
                        <span className="text-slate-400">…</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setDeepDivePage(pageNumber)}
                        disabled={deepDiveImportsLoading}
                        className={`rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                          (deepDiveImports?.page || 1) === pageNumber
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        {pageNumber}
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDeepDivePage((current) => Math.min(deepDiveImports?.totalPages || 1, current + 1))}
                    disabled={deepDiveImportsLoading || (deepDiveImports?.page || 1) >= (deepDiveImports?.totalPages || 1)}
                    className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    →
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {deepDiveSection === 'errors' ? (
            <section className="surface-card space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Error Entries</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Symbols that have no bars yet or whose latest sync recorded an error.
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <label className="space-y-1">
                  <span className="text-sm font-medium">Search Errors</span>
                  <input
                    value={deepDiveErrorSearch}
                    onChange={(event) => {
                      setDeepDiveErrorSearch(event.target.value);
                      setDeepDiveErrorPage(1);
                    }}
                    className="field-input"
                    placeholder="Type symbol or company"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setDeepDiveErrorSearch('');
                      setDeepDiveErrorPage(1);
                    }}
                    className="btn-muted px-3 py-2 text-sm"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  Page {deepDiveErrors?.page || 1} of {deepDiveErrors?.totalPages || 1} | Matches {numberFormatter.format(deepDiveErrors?.totalMatches || 0)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDeepDiveErrorPage((current) => Math.max(1, current - 1))}
                    disabled={deepDiveErrorsLoading || (deepDiveErrors?.page || 1) <= 1}
                    className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  {buildPageNumbers(deepDiveErrors?.page || 1, deepDiveErrors?.totalPages || 1).map((pageNumber, index, pages) => (
                    <span key={`top-errors-${pageNumber}`} className="flex items-center gap-2">
                      {index > 0 && pageNumber - pages[index - 1] > 1 ? (
                        <span className="text-slate-400">…</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setDeepDiveErrorPage(pageNumber)}
                        disabled={deepDiveErrorsLoading}
                        className={`rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                          (deepDiveErrors?.page || 1) === pageNumber
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        {pageNumber}
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDeepDiveErrorPage((current) => Math.min(deepDiveErrors?.totalPages || 1, current + 1))}
                    disabled={deepDiveErrorsLoading || (deepDiveErrors?.page || 1) >= (deepDiveErrors?.totalPages || 1)}
                    className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>

              {deepDiveErrorsLoading ? (
                <LoadingSpinner label="Loading error entries..." />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-[1100px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                          <th className="px-3 py-2">Issue</th>
                          <th className="px-3 py-2">Symbol</th>
                          <th className="px-3 py-2">Company</th>
                          <th className="px-3 py-2">Sector</th>
                          <th className="px-3 py-2">Industry</th>
                          <th className="px-3 py-2">Latest Bar</th>
                          <th className="px-3 py-2">Last Status</th>
                          <th className="px-3 py-2">Last Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(deepDiveErrors?.rows || []).map((item) => (
                          <tr key={`${item.issue}-${item.symbol}`} className="table-row-hover">
                            <td className="px-3 py-2 font-medium">{item.issue}</td>
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{item.symbol}</td>
                            <td className="px-3 py-2">{item.companyName || '-'}</td>
                            <td className="px-3 py-2">{item.sector || '-'}</td>
                            <td className="px-3 py-2">{item.industry || '-'}</td>
                            <td className="px-3 py-2">{item.latestBarDate || '-'}</td>
                            <td className="px-3 py-2">{item.lastStatus || '-'}</td>
                            <td className="px-3 py-2">{item.lastError || '-'}</td>
                          </tr>
                        ))}
                        {!deepDiveErrors?.rows?.length ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                              No error entries found.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
                    <p>
                      Page {deepDiveErrors?.page || 1} of {deepDiveErrors?.totalPages || 1}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDeepDiveErrorPage((current) => Math.max(1, current - 1))}
                        disabled={deepDiveErrorsLoading || (deepDiveErrors?.page || 1) <= 1}
                        className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ←
                      </button>
                      {buildPageNumbers(deepDiveErrors?.page || 1, deepDiveErrors?.totalPages || 1).map((pageNumber, index, pages) => (
                        <span key={`bottom-errors-${pageNumber}`} className="flex items-center gap-2">
                          {index > 0 && pageNumber - pages[index - 1] > 1 ? (
                            <span className="text-slate-400">…</span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setDeepDiveErrorPage(pageNumber)}
                            disabled={deepDiveErrorsLoading}
                            className={`rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                              (deepDiveErrors?.page || 1) === pageNumber
                                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                                : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                            }`}
                          >
                            {pageNumber}
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => setDeepDiveErrorPage((current) => Math.min(deepDiveErrors?.totalPages || 1, current + 1))}
                        disabled={deepDiveErrorsLoading || (deepDiveErrors?.page || 1) >= (deepDiveErrors?.totalPages || 1)}
                        className="btn-muted px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        →
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : activeTab === 'general' ? (
      <form onSubmit={handleSubmit} className="surface-card max-w-xl space-y-4 p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Total Capital</span>
          <input
            type="number"
            step="0.01"
            className="field-input"
            value={totalCapital}
            onChange={(e) => setTotalCapital(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Default Risk % (optional)</span>
          <input
            type="number"
            step="0.01"
            className="field-input"
            value={defaultRiskPercent}
            onChange={(e) => setDefaultRiskPercent(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Theme</span>
          <select className="field-input" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>

        <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-medium">Symbol Master (NSE)</legend>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            CSV Source: https://archives.nseindia.com/content/equities/EQUITY_L.csv
          </p>
          <p className="text-xs text-slate-700 dark:text-slate-300">Symbols loaded: {symbolsCount}</p>
          <p className="text-xs text-slate-700 dark:text-slate-300">
            Last updated: {symbolsUpdatedAt ? new Date(symbolsUpdatedAt).toLocaleString() : 'Not available'}
          </p>
          <button
            type="button"
            onClick={handleRefreshSymbols}
            disabled={refreshingSymbols}
            className="btn-muted px-3 py-1.5 text-sm disabled:cursor-wait disabled:opacity-60"
          >
            {refreshingSymbols ? 'Downloading...' : 'Download Latest CSV'}
          </button>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Accent Color</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ACCENT_THEMES).map(([key, palette]) => {
              const selected = key === accentColor;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAccentColor(key)}
                  className={`group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    selected
                      ? 'border-slate-500 bg-slate-100 text-slate-900 dark:border-slate-400 dark:bg-slate-800 dark:text-slate-100'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span
                    className="h-4 w-4 rounded-full border border-black/10"
                    style={{ backgroundColor: palette.primary }}
                    aria-hidden="true"
                  />
                  {palette.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-medium">Dashboard Cards</legend>
          <div className="grid gap-2 md:grid-cols-2">
            {[
              ['totalRealizedPnl', 'Total Realized P&L'],
              ['monthlyPnl', 'Monthly P&L'],
              ['totalCapitalAtRisk', 'Total Capital at Risk'],
              ['totalPositionSize', 'Total Position Size'],
              ['totalUnrealizedPnl', 'Total Unrealized P&L'],
              ['avgR', 'Avg R'],
              ['avgHoldingDays', 'Avg Holding Days'],
              ['winRate', 'Win Rate'],
              ['avgWinnerLoser', 'Avg Winner / Loser'],
              ['profitFactor', 'Profit Factor'],
              ['maxDrawdown', 'Max Drawdown'],
              ['tradesOpenCount', 'Trades / Open']
            ].map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(dashboardCards[key])}
                  onChange={(e) =>
                    setDashboardCards((prev) => ({
                      ...prev,
                      [key]: e.target.checked
                    }))
                  }
                />
                <span className="text-sm font-medium">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <section className="space-y-2 pt-1" aria-labelledby="tradingview-settings-heading">
          <div className="h-px w-full bg-slate-200 dark:bg-slate-700" />
          <h2
            id="tradingview-settings-heading"
            className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
          >
            TradingView Related Settings
          </h2>
        </section>

        <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-medium">Trade Chart</legend>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Default Timeframe</span>
            <select
              className="field-input"
              value={chartDefaultTimeframe}
              onChange={(e) => setChartDefaultTimeframe(e.target.value)}
            >
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="1D">Daily</option>
              <option value="1W">Weekly</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">SMA Thickness</span>
            <select
              className="field-input"
              value={smaLineWidth}
              onChange={(e) => setSmaLineWidth(e.target.value)}
            >
              <option value="thin">Thin</option>
              <option value="medium">Medium</option>
              <option value="thick">Thick</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={smaScaleLabelsVisible}
              onChange={(e) => setSmaScaleLabelsVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show SMA Labels On Scale</span>
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-1">
                <span className="text-sm font-medium">SMA {index + 1}</span>
                <input
                  type="number"
                  min="1"
                  className="field-input"
                  value={smaPeriods[index] || ''}
                  onChange={(e) =>
                    setSmaPeriods((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))
                  }
                />
                <input
                  type="color"
                  className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                  value={smaColors[index] || '#000000'}
                  onChange={(e) =>
                    setSmaColors((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))
                  }
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Entry Arrow Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={entryArrowColor}
                onChange={(e) => setEntryArrowColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Exit Arrow Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={exitArrowColor}
                onChange={(e) => setExitArrowColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Entry Arrow Size</span>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="3"
                className="field-input"
                value={entryArrowSize}
                onChange={(e) => setEntryArrowSize(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Exit Arrow Size</span>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="3"
                className="field-input"
                value={exitArrowSize}
                onChange={(e) => setExitArrowSize(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Entry Label Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={entryLabelColor}
                onChange={(e) => setEntryLabelColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Exit Label Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={exitLabelColor}
                onChange={(e) => setExitLabelColor(e.target.value)}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm font-medium">Label Font</span>
              <select
                className="field-input"
                value={labelFontFamily}
                onChange={(e) => setLabelFontFamily(e.target.value)}
              >
                <option value="Trebuchet MS, Roboto, sans-serif">Trebuchet</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Courier New, monospace">Courier New</option>
                <option value="Verdana, sans-serif">Verdana</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Label Font Size</span>
              <input
                type="number"
                min="10"
                max="24"
                className="field-input"
                value={labelFontSize}
                onChange={(e) => setLabelFontSize(e.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-medium">Purple Dot Volume Indicator</legend>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotVisible}
              onChange={(e) => setPurpleDotVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show indicator (Single Pane)</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotLeftPaneVisible}
              onChange={(e) => setPurpleDotLeftPaneVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show in Left Pane</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotRightPaneVisible}
              onChange={(e) => setPurpleDotRightPaneVisible(e.target.checked)}
            />
            <span className="text-sm font-medium">Show in Right Pane</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={purpleDotCombineConditions}
              onChange={(e) => setPurpleDotCombineConditions(e.target.checked)}
            />
            <span className="text-sm font-medium">Combine conditions</span>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Volume Above</span>
              <input
                type="number"
                min="0"
                step="1"
                className="field-input"
                value={purpleDotVolumeAbove}
                onChange={(e) => setPurpleDotVolumeAbove(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">% Threshold</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="field-input"
                value={purpleDotPercentThreshold}
                onChange={(e) => setPurpleDotPercentThreshold(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Dot Color</span>
              <input
                type="color"
                className="h-10 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                value={purpleDotColor}
                onChange={(e) => setPurpleDotColor(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Dot Size</span>
              <input
                type="number"
                min="0.5"
                max="3"
                step="0.1"
                className="field-input"
                value={purpleDotSize}
                onChange={(e) => setPurpleDotSize(e.target.value)}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm font-medium">Dot Position</span>
              <select
                className="field-input"
                value={purpleDotPosition}
                onChange={(e) => setPurpleDotPosition(e.target.value)}
              >
                <option value="belowBar">Below Bar</option>
                <option value="aboveBar">Above Bar</option>
              </select>
            </label>
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-4 py-2"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
      ) : null}
    </div>
  );
};

export default SettingsPage;
