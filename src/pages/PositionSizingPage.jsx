import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import {
  calculatePositionSizing,
  getDefaultPositionSizingState,
  POSITION_SIZING_MODES
} from '../utils/positionSizing';

const STOP_LOSS_PCTS = Array.from({ length: 36 }, (_, index) => Number((1.5 + index * 0.1).toFixed(1)));
const CAR_PCTS = Array.from({ length: 10 }, (_, index) => Number((0.1 + index * 0.1).toFixed(1)));
const ALLOCATION_PCTS = Array.from({ length: 36 }, (_, index) => 5 + index);
const DEFAULT_CAR_PCT = 0.3;
const DEFAULT_ALLOCATION_PCT = 10;

const limitPriceInput = (value) => {
  const next = String(value ?? '');
  if (next === '') return '';
  if (!/^\d*\.?\d*$/.test(next)) return next.slice(0, -1);
  const [whole, decimal = ''] = next.split('.');
  return decimal ? `${whole}.${decimal.slice(0, 2)}` : whole;
};

const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const integerText = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : '—';
};

const percentText = (value) =>
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : '—';

const metricValueClass = 'text-base font-semibold text-slate-900 dark:text-slate-100 md:text-lg';
const outputCardClass = (isHighlighted = false) =>
  `rounded-lg border p-2.5 dark:bg-slate-950/40 ${
    isHighlighted
      ? 'border-emerald-400 bg-emerald-50/90 shadow-sm dark:border-emerald-600 dark:bg-emerald-950/30'
      : 'border-slate-200/80 bg-slate-50/70 dark:border-slate-800'
  }`;

const PositionSizingPage = () => {
  const { settings, loading } = useSettings();
  const [form, setForm] = useState(() => getDefaultPositionSizingState(null));
  const [selectedStopLossPct, setSelectedStopLossPct] = useState(3);
  const [stopLossPercentInput, setStopLossPercentInput] = useState('3.0');

  const defaults = useMemo(() => getDefaultPositionSizingState(settings), [settings]);
  const totalCapital = Number(settings?.totalCapital || 0);

  useEffect(() => {
    setForm(defaults);
  }, [defaults]);

  useEffect(() => {
    if (stopLossPercentInput === '') return;
    const stopLossPct = Number(stopLossPercentInput);
    const entryPrice = Number(form.entryPrice || 0);
    if (!(entryPrice > 0) || !(stopLossPct > 0)) return;
    const matchedPreset = STOP_LOSS_PCTS.find((pct) => Math.abs(pct - stopLossPct) < 0.000001);
    setSelectedStopLossPct(matchedPreset ?? null);
    const multiplier = form.side === 'SHORT' ? 1 + stopLossPct / 100 : 1 - stopLossPct / 100;
    const nextStopLoss = Number((entryPrice * multiplier).toFixed(2));
    if (nextStopLoss > 0) {
      setForm((prev) => ({ ...prev, stopLoss: String(nextStopLoss) }));
    }
  }, [form.entryPrice, form.side, stopLossPercentInput]);

  const result = useMemo(
    () =>
      calculatePositionSizing({
        side: form.side,
        entryPrice: form.entryPrice,
        stopLoss: form.stopLoss,
        sizingMode: form.sizingMode,
        sizingValue: form.sizingValue,
        totalCapital
      }),
    [form, totalCapital]
  );

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const handleReset = () => {
    setSelectedStopLossPct(3);
    setStopLossPercentInput('3.0');
    setForm(defaults);
  };
  const activeMode = POSITION_SIZING_MODES.find((mode) => mode.id === form.sizingMode) || POSITION_SIZING_MODES[0];
  const sizingValueAmount =
    form.sizingMode === 'RISK_PERCENT'
      ? result.riskAmount
      : form.sizingMode === 'ALLOCATION_PERCENT'
        ? result.allocationAmount
        : NaN;
  const sizingValueChoices = form.sizingMode === 'RISK_PERCENT' ? CAR_PCTS : ALLOCATION_PCTS;
  const highlightRiskPercent = form.sizingMode === 'RISK_PERCENT';
  const highlightAllocationPercent = form.sizingMode === 'ALLOCATION_PERCENT';

  if (loading) return <p>Loading settings...</p>;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Position Sizing</h1>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Standalone calculator for risk-based and allocation-based position sizing.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] md:items-start">
        <section className="surface-card space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Inputs</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Choose capital-at-risk or allocation sizing with preset percentage buttons.
              </p>
            </div>
            <button type="button" onClick={handleReset} className="btn-muted px-2.5 py-1.5 text-xs">
              Reset
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Side</span>
              <select className="field-input" value={form.side} onChange={(e) => setField('side', e.target.value)}>
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </label>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Account Capital
              </p>
              <p className="mt-1 text-lg font-semibold">{money(totalCapital)}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Default Risk %: {settings?.defaultRiskPercent ? percentText(settings.defaultRiskPercent) : 'Not set'}
              </p>
            </div>

            <label className="space-y-1">
              <span className="text-sm font-medium">Entry Price</span>
              <input
                type="number"
                step="0.01"
                className="field-input"
                value={form.entryPrice}
                onChange={(e) => setField('entryPrice', limitPriceInput(e.target.value))}
                placeholder="Enter entry price"
              />
              {result.errors.entryPrice ? <p className="text-sm text-red-600">{result.errors.entryPrice}</p> : null}
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Stop Loss</span>
              <div className="grid grid-cols-6 gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-950/40">
                {STOP_LOSS_PCTS.map((pct) => {
                  const isActive = selectedStopLossPct === pct;
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        setSelectedStopLossPct(pct);
                        setStopLossPercentInput(pct.toFixed(1));
                      }}
                      className={
                        isActive
                          ? 'btn-brand-soft px-2 py-1 text-xs font-medium'
                          : 'btn-muted px-2 py-1 text-xs'
                      }
                    >
                      {pct.toFixed(1)}%
                    </button>
                  );
                })}
              </div>
              <input
                type="number"
                step="0.1"
                min="0"
                className="field-input"
                value={stopLossPercentInput}
                onChange={(e) => {
                  setSelectedStopLossPct(null);
                  setStopLossPercentInput(e.target.value);
                }}
                placeholder="Enter stop loss %"
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Stop loss percentage. Choose a preset or type any manual % value.
              </p>
              <span className="text-sm font-medium">Manual Stop Loss Price</span>
              <input
                type="number"
                step="0.01"
                className="field-input"
                value={form.stopLoss}
                onChange={(e) => {
                  const nextStopLoss = limitPriceInput(e.target.value);
                  setSelectedStopLossPct(null);
                  setField('stopLoss', nextStopLoss);
                }}
                placeholder="Enter stop loss price manually"
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Derived SL % from manual price:{' '}
                {Number.isFinite(result.stopLossDistancePercent) ? percentText(result.stopLossDistancePercent) : '—'}
              </p>
              {result.errors.stopLoss ? <p className="text-sm text-red-600">{result.errors.stopLoss}</p> : null}
              {!result.errors.stopLoss && result.errors.stopLossDistance ? (
                <p className="text-sm text-red-600">{result.errors.stopLossDistance}</p>
              ) : null}
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">Sizing Mode</span>
            <div className="flex flex-wrap gap-2">
              {POSITION_SIZING_MODES.map((mode) => {
                const isActive = mode.id === form.sizingMode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setField('sizingMode', mode.id);
                      if (mode.id === 'RISK_PERCENT' && !CAR_PCTS.includes(Number(form.sizingValue))) {
                        setField('sizingValue', String(DEFAULT_CAR_PCT));
                      }
                      if (mode.id === 'ALLOCATION_PERCENT' && !ALLOCATION_PCTS.includes(Number(form.sizingValue))) {
                        setField('sizingValue', String(DEFAULT_ALLOCATION_PCT));
                      }
                    }}
                    className={
                      isActive
                        ? 'btn-brand-soft px-3 py-1.5 text-sm font-medium'
                        : 'btn-muted px-3 py-1.5 text-sm'
                      }
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="space-y-1">
            <span className="text-sm font-medium">Sizing Value</span>
            <div
              className={`grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-950/40 ${
                form.sizingMode === 'RISK_PERCENT' ? 'grid-cols-5' : 'grid-cols-6'
              }`}
            >
              {sizingValueChoices.map((value) => {
                const isActive = Number(form.sizingValue) === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setField('sizingValue', String(value))}
                    className={
                      isActive
                        ? 'btn-brand-soft px-2 py-1 text-xs font-medium'
                        : 'btn-muted px-2 py-1 text-xs'
                    }
                  >
                    {form.sizingMode === 'RISK_PERCENT' ? `${value.toFixed(1)}%` : `${value}%`}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Value in INR: {Number.isFinite(sizingValueAmount) ? money(sizingValueAmount) : '—'}
            </p>
            {result.errors.sizingValue ? <p className="text-sm text-red-600">{result.errors.sizingValue}</p> : null}
            {result.errors.totalCapital ? <p className="text-sm text-red-600">{result.errors.totalCapital}</p> : null}
            {result.errors.recommendedQty ? (
              <p className="text-sm text-red-600">{result.errors.recommendedQty}</p>
            ) : null}
          </label>

          {result.warnings.length ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-200">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </section>

        <section className="surface-card space-y-2.5 p-3">
          <div>
            <h2 className="text-base font-semibold">Sizing Output</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Results update live from the current inputs and settings.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className={outputCardClass()}>
              <p className="text-xs text-slate-600 dark:text-slate-400">Recommended Qty</p>
              <p className={metricValueClass}>{integerText(result.recommendedQty)}</p>
            </div>
            <div className={outputCardClass()}>
              <p className="text-xs text-slate-600 dark:text-slate-400">Position Value</p>
              <p className={metricValueClass}>
                {Number.isFinite(result.positionValue) ? money(result.positionValue) : '—'}
              </p>
            </div>
            <div className={outputCardClass()}>
              <p className="text-xs text-slate-600 dark:text-slate-400">Capital At Risk</p>
              <p className={metricValueClass}>
                {Number.isFinite(result.capitalAtRisk) ? money(result.capitalAtRisk) : '—'}
              </p>
            </div>
            <div className={outputCardClass(highlightRiskPercent)}>
              <p className="text-xs text-slate-600 dark:text-slate-400">Risk % of Capital</p>
              <p className={metricValueClass}>{percentText(result.riskPercentOfCapital)}</p>
            </div>
            <div className={outputCardClass(highlightAllocationPercent)}>
              <p className="text-xs text-slate-600 dark:text-slate-400">Allocation % of Capital</p>
              <p className={metricValueClass}>{percentText(result.allocationPercentOfCapital)}</p>
            </div>
            <div className={outputCardClass()}>
              <p className="text-xs text-slate-600 dark:text-slate-400">Per Unit Risk</p>
              <p className={metricValueClass}>
                {Number.isFinite(result.perUnitRisk) ? money(result.perUnitRisk) : '—'}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white/70 p-2.5 dark:border-slate-800 dark:bg-slate-950/30">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Breakdown
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">Sizing Mode</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">{activeMode.label}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">Risk Amount</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">
                  {Number.isFinite(result.riskAmount) ? money(result.riskAmount) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">Allocation Amount</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">
                  {Number.isFinite(result.allocationAmount) ? money(result.allocationAmount) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">Stop Loss Distance %</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">
                  {percentText(result.stopLossDistancePercent)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600 dark:text-slate-400">Direction</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">{form.side}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PositionSizingPage;
