import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Label,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useSettings } from '../contexts/SettingsContext';

const MAX_TOTAL_CAPITAL = 20_000_000;

const DEFAULTS = {
  winRate: 35,
  averageWinR: 3.5,
  tradesPerYear: 120,
  riskPerTradePercent: 0.4,
  totalCapital: 250000,
  tradesAt4R: 5,
  tradesAt5R: 3,
  tradesAt6R: 2,
  tradesAt7R: 0
};

const INPUTS = [
  {
    key: 'winRate',
    label: 'Win Rate',
    description: 'Overall win rate across all trades, including special winners.',
    min: 5,
    max: 95,
    step: 1,
    format: (value) => `${value.toFixed(0)}%`
  },
  {
    key: 'averageWinR',
    label: 'Average Winning Trade',
    description: 'Average multiple of R captured on winning trades.',
    min: 0.5,
    max: 10,
    step: 0.1,
    format: (value) => `${value.toFixed(1)}R`
  },
  {
    key: 'tradesPerYear',
    label: 'Trades Per Year',
    description: 'How many trades you expect to take in one year.',
    min: 10,
    max: 500,
    step: 5,
    format: (value) => `${value.toFixed(0)}`
  },
  {
    key: 'riskPerTradePercent',
    label: 'Risk Per Trade',
    description: 'Percent of account capital risked on each trade.',
    min: 0.1,
    max: 5,
    step: 0.05,
    format: (value) => `${value.toFixed(2)}%`
  },
  {
    key: 'totalCapital',
    label: 'Total Capital',
    description: 'Account size used to convert risk into INR terms.',
    min: 100000,
    max: MAX_TOTAL_CAPITAL,
    step: 1000,
    format: (value) =>
      new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }).format(value)
  }
];

const SPECIAL_WIN_INPUTS = [
  {
    key: 'tradesAt4R',
    label: '4R Trades',
    multiple: 4
  },
  {
    key: 'tradesAt5R',
    label: '5R Trades',
    multiple: 5
  },
  {
    key: 'tradesAt6R',
    label: '6R Trades',
    multiple: 6
  },
  {
    key: 'tradesAt7R',
    label: '7R Trades',
    multiple: 7
  }
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const roundToStep = (value, step) => {
  const precision = `${step}`.includes('.') ? `${step}`.split('.')[1].length : 0;
  return Number((Math.round(value / step) * step).toFixed(precision));
};

const percentText = (value, digits = 1) => `${Number(value || 0).toFixed(digits)}%`;
const rText = (value, digits = 2) => `${Number(value || 0).toFixed(digits)}R`;
const moneyText = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const signedRText = (value, digits = 2) => {
  const number = Number(value || 0);
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}R`;
};

const signedPercentText = (value, digits = 1) => {
  const number = Number(value || 0);
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}%`;
};

const ratioText = (value) => `${Number(value || 0).toFixed(1)} : 1`;

const metricValueClass = 'text-base font-semibold text-slate-900 dark:text-slate-100 md:text-lg';

const outputCardClass = (tone = 'default') => {
  if (tone === 'positive') {
    return 'rounded-lg border border-emerald-300 bg-emerald-50/90 p-3 shadow-sm dark:border-emerald-700/70 dark:bg-emerald-950/30';
  }
  if (tone === 'negative') {
    return 'rounded-lg border border-red-300 bg-red-50/90 p-3 shadow-sm dark:border-red-700/70 dark:bg-red-950/30';
  }
  return 'rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40';
};

const axisColor = (theme) => (theme === 'dark' ? '#94a3b8' : '#475569');
const gridColor = (theme) => (theme === 'dark' ? 'rgba(51, 65, 85, 0.7)' : 'rgba(148, 163, 184, 0.35)');
const tickColor = (theme) => (theme === 'dark' ? '#cbd5e1' : '#334155');

const getSpecialWinsCount = (inputs) =>
  SPECIAL_WIN_INPUTS.reduce((sum, config) => sum + Number(inputs[config.key] || 0), 0);

const getSpecialWinRTotal = (inputs) =>
  SPECIAL_WIN_INPUTS.reduce((sum, config) => sum + Number(inputs[config.key] || 0) * config.multiple, 0);

const getMaxSpecialWinsAllowed = (inputs) => Math.round((inputs.tradesPerYear * inputs.winRate) / 100);

const normalizeSpecialTradeCounts = (inputs) => {
  const next = { ...inputs };
  let excess = getSpecialWinsCount(next) - getMaxSpecialWinsAllowed(next);
  if (excess <= 0) return next;

  for (const key of ['tradesAt7R', 'tradesAt6R', 'tradesAt5R', 'tradesAt4R']) {
    if (excess <= 0) break;
    const current = Number(next[key] || 0);
    const reduction = Math.min(current, excess);
    next[key] = current - reduction;
    excess -= reduction;
  }

  return next;
};

const calculateScenarioMetrics = (inputs) => {
  const specialWinsCount = getSpecialWinsCount(inputs);
  const targetWinningTrades = (inputs.tradesPerYear * inputs.winRate) / 100;
  const regularWinners = Math.max(targetWinningTrades - specialWinsCount, 0);
  const regularLosers = Math.max(inputs.tradesPerYear - targetWinningTrades, 0);
  const remainingTrades = regularWinners + regularLosers;
  const specialWinRTotal = getSpecialWinRTotal(inputs);
  const regularWinRTotal = regularWinners * inputs.averageWinR;
  const totalWinningTrades = specialWinsCount + regularWinners;
  const totalWinR = specialWinRTotal + regularWinRTotal;
  const annualR = totalWinR - regularLosers;
  const actualWinRate = inputs.tradesPerYear > 0 ? (totalWinningTrades / inputs.tradesPerYear) * 100 : 0;
  const lossRate = 100 - actualWinRate;
  const expectancyR = inputs.tradesPerYear > 0 ? annualR / inputs.tradesPerYear : 0;
  const annualReturnPercent = annualR * inputs.riskPerTradePercent;
  const riskPerTradeAmount = (Number(inputs.totalCapital || 0) * inputs.riskPerTradePercent) / 100;
  const expectedAnnualReturnAmount = (Number(inputs.totalCapital || 0) * annualReturnPercent) / 100;
  const effectiveAverageWinR = totalWinningTrades > 0 ? totalWinR / totalWinningTrades : 0;
  const breakEvenWinRate = effectiveAverageWinR > 0 ? 100 / (effectiveAverageWinR + 1) : 100;

  return {
    specialWinsCount,
    remainingTrades,
    regularWinners,
    regularLosers,
    specialWinRTotal,
    totalWinningTrades,
    totalWinR,
    annualR,
    actualWinRate,
    lossRate,
    expectancyR,
    annualReturnPercent,
    riskPerTradeAmount,
    expectedAnnualReturnAmount,
    effectiveAverageWinR,
    breakEvenWinRate
  };
};

const buildWinRateSeries = ({ averageWinR, tradesPerYear, riskPerTradePercent, specialTradeCounts }) =>
  Array.from({ length: 17 }, (_, index) => {
    const scenario = calculateScenarioMetrics({
      winRate: 10 + index * 5,
      averageWinR,
      tradesPerYear,
      riskPerTradePercent,
      ...specialTradeCounts
    });
    return {
      winRate: 10 + index * 5,
      annualReturnPercent: scenario.annualReturnPercent,
      expectancyR: scenario.expectancyR
    };
  });

const buildAverageWinSeries = ({ winRate, tradesPerYear, riskPerTradePercent, specialTradeCounts }) =>
  Array.from({ length: 20 }, (_, index) => {
    const averageWinR = Number((0.5 + index * 0.5).toFixed(1));
    const scenario = calculateScenarioMetrics({
      winRate,
      averageWinR,
      tradesPerYear,
      riskPerTradePercent,
      ...specialTradeCounts
    });
    return {
      averageWinR,
      annualReturnPercent: scenario.annualReturnPercent,
      expectancyR: scenario.expectancyR
    };
  });

const ChartTooltip = ({ active, payload, label, valueLabel, labelFormatter, valueFormatter }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const value = point?.annualReturnPercent;
  const expectancyR = point?.expectancyR;

  return (
    <div className="rounded border border-slate-300 bg-white px-3 py-2 text-xs shadow dark:border-slate-700 dark:bg-slate-900">
      <p className="font-medium">{labelFormatter ? labelFormatter(label) : label}</p>
      <p className="text-slate-700 dark:text-slate-200">
        {valueLabel}: {valueFormatter ? valueFormatter(value) : value}
      </p>
      <p className="text-slate-500 dark:text-slate-400">Expectancy: {signedRText(expectancyR)}</p>
    </div>
  );
};

const SliderField = ({ config, value, onChange, auxiliaryText = '' }) => {
  const { key, label, description, min, max, step, format } = config;
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitDraftValue = (rawValue) => {
    const nextValue = Number(rawValue);
    if (Number.isNaN(nextValue)) {
      setDraftValue(String(value));
      return;
    }
    onChange(key, roundToStep(clamp(nextValue, min, max), step));
  };

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{description}</p>
        </div>
        <div className="min-w-[8rem] text-right">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{format(value)}</p>
          {auxiliaryText ? (
            <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">{auxiliaryText}</p>
          ) : null}
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {min}
            {' - '}
            {max}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem] md:items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(key, Number(event.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[var(--brand-primary)] dark:bg-slate-800"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={(event) => commitDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitDraftValue(event.currentTarget.value);
              event.currentTarget.blur();
            }
          }}
          className="field-input"
        />
      </div>
    </div>
  );
};

const RiskRewardSimulatorPage = () => {
  const { theme, settings } = useSettings();
  const [inputs, setInputs] = useState(() => normalizeSpecialTradeCounts(DEFAULTS));

  useEffect(() => {
    const configuredCapital = Number(settings?.totalCapital || 0);
    if (!(configuredCapital > 0)) return;
    setInputs((current) =>
      normalizeSpecialTradeCounts({
        ...current,
        totalCapital: clamp(configuredCapital, 100000, MAX_TOTAL_CAPITAL)
      })
    );
  }, [settings?.totalCapital]);

  const metrics = useMemo(() => calculateScenarioMetrics(inputs), [inputs]);

  const specialTradeCounts = useMemo(
    () =>
      SPECIAL_WIN_INPUTS.reduce((accumulator, config) => {
        accumulator[config.key] = inputs[config.key];
        return accumulator;
      }, {}),
    [inputs]
  );

  const winRateSeries = useMemo(
    () =>
      buildWinRateSeries({
        averageWinR: inputs.averageWinR,
        tradesPerYear: inputs.tradesPerYear,
        riskPerTradePercent: inputs.riskPerTradePercent,
        specialTradeCounts
      }),
    [inputs.averageWinR, inputs.tradesPerYear, inputs.riskPerTradePercent, specialTradeCounts]
  );

  const averageWinSeries = useMemo(
    () =>
      buildAverageWinSeries({
        winRate: inputs.winRate,
        tradesPerYear: inputs.tradesPerYear,
        riskPerTradePercent: inputs.riskPerTradePercent,
        specialTradeCounts
      }),
    [inputs.winRate, inputs.tradesPerYear, inputs.riskPerTradePercent, specialTradeCounts]
  );

  const handleInputChange = (key, value) => {
    setInputs((current) => {
      const next = { ...current, [key]: value };
      if (SPECIAL_WIN_INPUTS.some((config) => config.key === key)) {
        next[key] = Math.max(Math.round(value), 0);
      }
      return normalizeSpecialTradeCounts(next);
    });
  };

  const resetInputs = () => setInputs(normalizeSpecialTradeCounts(DEFAULTS));
  const expectancyTone =
    metrics.expectancyR > 0.0001 ? 'positive' : metrics.expectancyR < -0.0001 ? 'negative' : 'default';
  const annualTone =
    metrics.annualReturnPercent > 0.0001 ? 'positive' : metrics.annualReturnPercent < -0.0001 ? 'negative' : 'default';

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Risk-Reward Simulator
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Tune base win rate, average reward in R, trade frequency, explicit `4R` to `7R` winners, and account
              risk per trade to understand how expectancy translates into yearly outcomes.
            </p>
          </div>
          <button type="button" onClick={resetInputs} className="btn-muted px-3 py-2 text-sm">
            Reset to Defaults
          </button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section className="surface-card space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Interactive Inputs</h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Losing trades are fixed at <span className="font-semibold">-1R</span>. Special `4R` to `7R` trades are
              treated as part of the overall winning trades inside the yearly total.
            </p>
          </div>

          <div className="space-y-3">
            {INPUTS.map((config) => (
              <SliderField
                key={config.key}
                config={config}
                value={inputs[config.key]}
                onChange={handleInputChange}
                auxiliaryText={
                  config.key === 'riskPerTradePercent' ? `Risk amount: ${moneyText(metrics.riskPerTradeAmount)}` : ''
                }
              />
            ))}
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Special Winners Mix</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Allocate how many trades out of the year become `4R`, `5R`, `6R`, and `7R` winners.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-right dark:border-slate-700 dark:bg-slate-900/80">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Special Winners
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{metrics.specialWinsCount}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Max allowed: {getMaxSpecialWinsAllowed(inputs)}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {SPECIAL_WIN_INPUTS.map((config) => (
                <SliderField
                  key={config.key}
                  config={{
                    key: config.key,
                    label: config.label,
                    description: `Number of trades booked at exactly ${config.multiple}R.`,
                    min: 0,
                    max: inputs.tradesPerYear,
                    step: 1,
                    format: (value) => `${Number(value).toFixed(0)}`
                  }}
                  value={inputs[config.key]}
                  onChange={handleInputChange}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="surface-card space-y-3 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Live Output</h2>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Expectancy and annual return update instantly from the sliders.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={outputCardClass()}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Loss Rate</p>
                <p className={metricValueClass}>{percentText(metrics.lossRate)}</p>
              </div>
              <div className={outputCardClass()}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Effective Risk-Reward</p>
                <p className={metricValueClass}>{ratioText(metrics.effectiveAverageWinR)}</p>
              </div>
              <div className={outputCardClass(expectancyTone)}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Expectancy / Trade</p>
                <p className={metricValueClass}>{signedRText(metrics.expectancyR)}</p>
              </div>
              <div className={outputCardClass(expectancyTone)}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Expected Annual R</p>
                <p className={metricValueClass}>{signedRText(metrics.annualR)}</p>
              </div>
              <div className={outputCardClass(annualTone)}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Expected Annual Return</p>
                <p className={metricValueClass}>{signedPercentText(metrics.annualReturnPercent)}</p>
              </div>
              <div className={outputCardClass()}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Risk Per Trade in INR</p>
                <p className={metricValueClass}>{moneyText(metrics.riskPerTradeAmount)}</p>
              </div>
              <div className={outputCardClass(annualTone)}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Expected Annual Return in INR</p>
                <p className={metricValueClass}>{moneyText(metrics.expectedAnnualReturnAmount)}</p>
              </div>
              <div className={outputCardClass()}>
                <p className="text-xs text-slate-600 dark:text-slate-400">Break-Even Win Rate</p>
                <p className={metricValueClass}>{percentText(metrics.breakEvenWinRate)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/30">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Scenario Readout
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Special Winners / Year</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {metrics.specialWinsCount}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Regular Winners / Year</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {Math.round(metrics.regularWinners)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Regular Losers / Year</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {Math.round(metrics.regularLosers)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Base Average Win Size</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">{rText(inputs.averageWinR, 1)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Total Capital</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">{moneyText(inputs.totalCapital)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Remaining Non-Special Trades</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">{metrics.remainingTrades}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Risk / Trade</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {percentText(inputs.riskPerTradePercent, 2)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600 dark:text-slate-400">Risk / Trade in INR</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {moneyText(metrics.riskPerTradeAmount)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="surface-card space-y-3 p-5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Formula & Assumptions</h2>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
              <p>Total Winners = Trades Per Year × Win Rate</p>
              <p className="mt-2">Regular Winners = Total Winners - Special Winners</p>
              <p className="mt-2">Annual R = Regular Winners × Base Avg Win R + Special Winner R Total - Regular Losers × 1R</p>
              <p className="mt-2">Expectancy = Annual R ÷ Trades Per Year</p>
              <p className="mt-2">Expected Annual Return % = Expected Annual R × Risk Per Trade %</p>
              <p className="mt-2">Risk Per Trade ₹ = Total Capital × Risk Per Trade %</p>
            </div>
            <div className="text-xs leading-6 text-slate-600 dark:text-slate-400">
              This tool models a fixed <span className="font-semibold">-1R</span> loss on every regular losing trade.
              Special `4R` to `7R` trades are counted inside the overall winning bucket, so they cannot exceed the win
              count implied by the selected win rate. The output is an expectation model only and does not simulate
              compounding, variance, or drawdown sequencing.
            </div>
          </div>
        </section>
      </div>

      <section className="surface-card space-y-5 p-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Sensitivity View</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            See how your expected annual return changes when one edge improves while the others stay fixed.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
            <div className="mb-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Annual Return vs Win Rate</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Special `4R` to `7R` winners, base average win size, trade count, and risk per trade stay fixed.
              </p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={winRateSeries} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor(theme)} />
                  <XAxis
                    dataKey="winRate"
                    stroke={axisColor(theme)}
                    tick={{ fill: tickColor(theme), fontSize: 12 }}
                    tickFormatter={(value) => `${value}%`}
                  >
                    <Label value="Win Rate (%)" position="insideBottom" offset={-4} fill={tickColor(theme)} />
                  </XAxis>
                  <YAxis
                    stroke={axisColor(theme)}
                    tick={{ fill: tickColor(theme), fontSize: 12 }}
                    tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  >
                    <Label
                      value="Annual Return (%)"
                      angle={-90}
                      position="insideLeft"
                      style={{ textAnchor: 'middle', fill: tickColor(theme), fontSize: 11 }}
                    />
                  </YAxis>
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueLabel="Expected Annual Return"
                        labelFormatter={(value) => `Win Rate: ${value}%`}
                        valueFormatter={(value) => signedPercentText(value)}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="annualReturnPercent"
                    stroke="#16a34a"
                    strokeWidth={3}
                    dot={{ r: 2.5, strokeWidth: 1, fill: '#16a34a' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
            <div className="mb-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Annual Return vs Average Win</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Base win rate, special winners mix, trade count, and risk per trade stay fixed.
              </p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={averageWinSeries} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor(theme)} />
                  <XAxis
                    dataKey="averageWinR"
                    stroke={axisColor(theme)}
                    tick={{ fill: tickColor(theme), fontSize: 12 }}
                    tickFormatter={(value) => `${value}R`}
                  >
                    <Label value="Average Win (R)" position="insideBottom" offset={-4} fill={tickColor(theme)} style={{ fontSize: 11 }} />
                  </XAxis>
                  <YAxis
                    stroke={axisColor(theme)}
                    tick={{ fill: tickColor(theme), fontSize: 12 }}
                    tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  >
                    <Label
                      value="Annual Return (%)"
                      angle={-90}
                      position="insideLeft"
                      style={{ textAnchor: 'middle', fill: tickColor(theme), fontSize: 11 }}
                    />
                  </YAxis>
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueLabel="Expected Annual Return"
                        labelFormatter={(value) => `Average Win: ${value}R`}
                        valueFormatter={(value) => signedPercentText(value)}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="annualReturnPercent"
                    stroke="#0f766e"
                    strokeWidth={3}
                    dot={{ r: 2.5, strokeWidth: 1, fill: '#0f766e' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default RiskRewardSimulatorPage;
