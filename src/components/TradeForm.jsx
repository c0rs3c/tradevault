import { useState } from 'react';
import PropTypes from 'prop-types';
import ScreenshotManager from './ScreenshotManager';
import TradeStrategySelector from './TradeStrategySelector';
import { normalizeOptionList, joinOptionList } from '../utils/tradeOptions';

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const STOP_LOSS_PCTS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5];

const initialValues = {
  symbol: '',
  side: 'LONG',
  entryDate: todayInputDate(),
  entryPrice: '',
  entryQty: '',
  stopLoss: '',
  strategy: [],
  pastTradeMarketComment: '',
  pastTradeGeneralComment: '',
  notes: '',
  screenshots: []
};

const TradeForm = ({ defaultValues = initialValues, onSubmit, submitting, symbolOptions = [] }) => {
  const [values, setValues] = useState(() => {
    const merged = { ...initialValues, ...defaultValues };
    return {
      ...merged,
      entryDate: merged.entryDate ? String(merged.entryDate).slice(0, 10) : todayInputDate(),
      strategy: normalizeOptionList(merged.strategy)
    };
  });
  const [errors, setErrors] = useState({});
  const [uploadError, setUploadError] = useState('');
  const [selectedStopLossPct, setSelectedStopLossPct] = useState(3);
  const [pendingScreenshotFiles, setPendingScreenshotFiles] = useState([]);

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
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const invalidType = files.find((file) => !file.type.startsWith('image/'));
    if (invalidType) {
      setUploadError('Please upload only image files');
      return;
    }

    const invalidSize = files.find((file) => file.size > 5 * 1024 * 1024);
    if (invalidSize) {
      setUploadError('Each screenshot must be 5MB or smaller');
      return;
    }

    setUploadError('');
    setPendingScreenshotFiles((prev) => [...prev, ...files]);
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
      strategy: joinOptionList(values.strategy),
      pastTradeMarketComment: values.pastTradeMarketComment,
      pastTradeGeneralComment: values.pastTradeGeneralComment,
      entryPrice: Number(values.entryPrice),
      entryQty: Number(values.entryQty),
      stopLoss: values.stopLoss === '' ? undefined : Number(values.stopLoss),
      screenshots: values.screenshots || [],
      screenshotFiles: pendingScreenshotFiles
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

        <TradeStrategySelector value={values.strategy} onToggle={toggleStrategy} className="md:col-span-2" />

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Past Trade Market Comment</span>
          <textarea
            className="field-input min-h-24"
            value={values.pastTradeMarketComment}
            onChange={(e) => setField('pastTradeMarketComment', e.target.value)}
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Past Trade General Comment</span>
          <textarea
            className="field-input min-h-24"
            value={values.pastTradeGeneralComment}
            onChange={(e) => setField('pastTradeGeneralComment', e.target.value)}
          />
        </label>

        <div className="md:col-span-2">
          <ScreenshotManager
            label="Trade Screenshots (optional)"
            existingScreenshots={values.screenshots || []}
            pendingFiles={pendingScreenshotFiles}
            error={uploadError}
            inputId="trade-screenshots"
            onFilesSelected={handleScreenshotChange}
            onRemoveExisting={(index) =>
              setValues((prev) => ({
                ...prev,
                screenshots: (prev.screenshots || []).filter((_, itemIndex) => itemIndex !== index)
              }))
            }
            onRemovePending={(index) =>
              setPendingScreenshotFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        </div>

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
