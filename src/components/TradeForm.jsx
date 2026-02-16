import { useState } from 'react';
import PropTypes from 'prop-types';

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const STOP_LOSS_PCTS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5];
const STRATEGY_OPTIONS = ['In the Base', 'Outside Base', 'Expansion'];

const initialValues = {
  symbol: '',
  side: 'LONG',
  entryDate: todayInputDate(),
  entryPrice: '',
  entryQty: '',
  stopLoss: '',
  strategy: [],
  notes: '',
  screenshot: ''
};

const TradeForm = ({ defaultValues = initialValues, onSubmit, submitting, symbolOptions = [] }) => {
  const [values, setValues] = useState(() => {
    const merged = { ...initialValues, ...defaultValues };
    return {
      ...merged,
      entryDate: merged.entryDate ? String(merged.entryDate).slice(0, 10) : todayInputDate(),
      strategy: Array.isArray(merged.strategy)
        ? merged.strategy
        : String(merged.strategy || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
    };
  });
  const [errors, setErrors] = useState({});
  const [uploadError, setUploadError] = useState('');
  const [selectedStopLossPct, setSelectedStopLossPct] = useState(3);

  const setField = (field, value) => setValues((prev) => ({ ...prev, [field]: value }));

  const computeStopLossFromPct = (entryPrice, side, pct) => {
    const price = Number(entryPrice || 0);
    const pctNum = Number(pct || 0);
    if (price <= 0 || pctNum <= 0) return '';
    const multiplier = side === 'SHORT' ? 1 + pctNum / 100 : 1 - pctNum / 100;
    const result = Number((price * multiplier).toFixed(4));
    return Number.isFinite(result) && result > 0 ? String(result) : '';
  };

  const computeStopLossPercent = (entryPrice, stopLoss) => {
    const entry = Number(entryPrice || 0);
    const sl = Number(stopLoss || 0);
    if (entry <= 0 || sl <= 0) return null;
    const pct = (Math.abs(entry - sl) / entry) * 100;
    return Number.isFinite(pct) ? pct : null;
  };

  const applyStopLossPercent = (pct) => {
    setSelectedStopLossPct(pct);
    setField('stopLoss', computeStopLossFromPct(values.entryPrice, values.side, pct));
  };

  const toggleStrategy = (option) => {
    setValues((prev) => {
      const hasOption = prev.strategy.includes(option);
      const next = hasOption
        ? prev.strategy.filter((item) => item !== option)
        : [...prev.strategy, option];
      return { ...prev, strategy: next };
    });
  };

  const handleScreenshotChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setUploadError('');
      setField('screenshot', '');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setUploadError('Please upload an image file');
      setField('screenshot', '');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Screenshot must be 2MB or smaller');
      setField('screenshot', '');
      return;
    }

    const reader = new window.FileReader();
    reader.onload = () => {
      setUploadError('');
      setField('screenshot', reader.result);
    };
    reader.onerror = () => {
      setUploadError('Failed to read the image file');
      setField('screenshot', '');
    };
    reader.readAsDataURL(file);
  };

  const validate = () => {
    const next = {};
    if (!values.symbol.trim()) next.symbol = 'Symbol is required';
    if (!values.entryDate) next.entryDate = 'Entry date is required';
    if (Number(values.entryPrice) <= 0) next.entryPrice = 'Entry price must be > 0';
    if (Number(values.entryQty) <= 0) next.entryQty = 'Entry qty must be > 0';
    if (values.stopLoss !== '' && Number(values.stopLoss) <= 0) {
      next.stopLoss = 'Stop loss must be > 0';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!validate()) return;

    onSubmit({
      ...values,
      symbol: values.symbol.trim().toUpperCase(),
      strategy: values.strategy.join(', '),
      entryPrice: Number(values.entryPrice),
      entryQty: Number(values.entryQty),
      stopLoss: values.stopLoss === '' ? undefined : Number(values.stopLoss),
      screenshot: values.screenshot || undefined
    });
  };

  return (
    <form onSubmit={handleSubmit} className="surface-card space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium">Symbol</span>
          <input
            className="field-input"
            value={values.symbol}
            onChange={(e) => setField('symbol', e.target.value)}
            list="trade-symbol-options"
          />
          <datalist id="trade-symbol-options">
            {symbolOptions.map((symbol) => (
              <option key={symbol} value={symbol} />
            ))}
          </datalist>
          {errors.symbol && <span className="text-sm text-red-600">{errors.symbol}</span>}
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Side</span>
          <select
            className="field-input"
            value={values.side}
            onChange={(e) => {
              const nextSide = e.target.value;
              setField('side', nextSide);
              if (selectedStopLossPct) {
                setField('stopLoss', computeStopLossFromPct(values.entryPrice, nextSide, selectedStopLossPct));
              }
            }}
          >
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Entry Date</span>
          <input
            type="date"
            className="field-input"
            value={values.entryDate ? values.entryDate.slice(0, 10) : ''}
            onChange={(e) => setField('entryDate', e.target.value)}
          />
          {errors.entryDate && <span className="text-sm text-red-600">{errors.entryDate}</span>}
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Entry Price</span>
          <input
            type="number"
            step="0.0001"
            className="field-input"
            value={values.entryPrice}
            onChange={(e) => {
              const next = e.target.value;
              setField('entryPrice', next);
              if (selectedStopLossPct) {
                setField('stopLoss', computeStopLossFromPct(next, values.side, selectedStopLossPct));
              }
            }}
          />
          {errors.entryPrice && <span className="text-sm text-red-600">{errors.entryPrice}</span>}
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Entry Qty</span>
          <input
            type="number"
            step="0.0001"
            className="field-input"
            value={values.entryQty}
            onChange={(e) => setField('entryQty', e.target.value)}
          />
          {errors.entryQty && <span className="text-sm text-red-600">{errors.entryQty}</span>}
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Stop Loss Price</span>
          <div className="flex flex-wrap gap-2">
            {STOP_LOSS_PCTS.map((pct) => {
              const isActive = selectedStopLossPct === pct;
              return (
                <button
                  key={pct}
                  type="button"
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                  onClick={() => applyStopLossPercent(pct)}
                >
                  {pct}% SL
                </button>
              );
            })}
          </div>
          <input
            type="number"
            step="0.0001"
            className="field-input"
            value={values.stopLoss}
            onChange={(e) => {
              setSelectedStopLossPct(null);
              setField('stopLoss', e.target.value);
            }}
            placeholder="Enter stop loss price manually"
          />
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {values.stopLoss
              ? (() => {
                  const pct = computeStopLossPercent(values.entryPrice, values.stopLoss);
                  return pct === null
                    ? `Selected SL Price: ${values.stopLoss}`
                    : `Selected SL Price: ${values.stopLoss} (${pct.toFixed(2)}%)`;
                })()
              : 'Select % SL or enter a manual price'}
          </span>
          {errors.stopLoss && <span className="text-sm text-red-600">{errors.stopLoss}</span>}
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Strategy</span>
          <div className="flex flex-wrap gap-2">
            {STRATEGY_OPTIONS.map((option) => {
              const isSelected = values.strategy.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleStrategy(option)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    isSelected
                      ? 'border-sky-600 bg-sky-100 text-sky-800 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-200'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Trade Screenshot (optional)</span>
          <input
            type="file"
            accept="image/*"
            className="field-input file:mr-4 file:rounded-md file:border-0 file:bg-slate-200 dark:file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 dark:file:text-slate-100 hover:file:bg-slate-300 dark:hover:file:bg-slate-700"
            onChange={handleScreenshotChange}
          />
          <span className="text-xs text-slate-600 dark:text-slate-400">PNG/JPG/WebP up to 2MB</span>
          {uploadError && <span className="text-sm text-red-500">{uploadError}</span>}
          {!!values.screenshot && (
            <div className="space-y-2">
              <img
                src={values.screenshot}
                alt="Trade screenshot preview"
                className="max-h-64 w-full rounded-md border border-slate-300 dark:border-slate-700 object-contain"
              />
              <button
                type="button"
                className="btn-muted px-3 py-1.5 text-xs"
                onClick={() => setField('screenshot', '')}
              >
                Remove screenshot
              </button>
            </div>
          )}
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            className="field-input min-h-24"
            value={values.notes}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary px-4 py-2"
      >
        {submitting ? 'Saving...' : 'Save Trade'}
      </button>
    </form>
  );
};

TradeForm.propTypes = {
  defaultValues: PropTypes.object,
  onSubmit: PropTypes.func.isRequired,
  submitting: PropTypes.bool,
  symbolOptions: PropTypes.arrayOf(PropTypes.string)
};

TradeForm.defaultProps = {
  defaultValues: initialValues,
  submitting: false,
  symbolOptions: []
};

export default TradeForm;
