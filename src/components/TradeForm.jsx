import { useState } from 'react';
import PropTypes from 'prop-types';

const initialValues = {
  symbol: '',
  side: 'LONG',
  entryDate: '',
  entryPrice: '',
  entryQty: '',
  stopLoss: '',
  lastPrice: '',
  strategy: '',
  notes: '',
  tags: '',
  screenshot: ''
};

const TradeForm = ({ defaultValues = initialValues, onSubmit, submitting }) => {
  const [values, setValues] = useState({ ...initialValues, ...defaultValues });
  const [errors, setErrors] = useState({});
  const [uploadError, setUploadError] = useState('');

  const setField = (field, value) => setValues((prev) => ({ ...prev, [field]: value }));

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
      tags: values.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      entryPrice: Number(values.entryPrice),
      entryQty: Number(values.entryQty),
      stopLoss: values.stopLoss === '' ? undefined : Number(values.stopLoss),
      lastPrice: values.lastPrice ? Number(values.lastPrice) : undefined,
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
          />
          {errors.symbol && <span className="text-sm text-red-600">{errors.symbol}</span>}
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Side</span>
          <select
            className="field-input"
            value={values.side}
            onChange={(e) => setField('side', e.target.value)}
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
            onChange={(e) => setField('entryPrice', e.target.value)}
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

        <label className="space-y-1">
          <span className="text-sm font-medium">Stop Loss (optional, defaults to 3%)</span>
          <input
            type="number"
            step="0.0001"
            className="field-input"
            value={values.stopLoss}
            onChange={(e) => setField('stopLoss', e.target.value)}
          />
          {errors.stopLoss && <span className="text-sm text-red-600">{errors.stopLoss}</span>}
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Last Price (optional)</span>
          <input
            type="number"
            step="0.0001"
            className="field-input"
            value={values.lastPrice}
            onChange={(e) => setField('lastPrice', e.target.value)}
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Strategy</span>
          <input
            className="field-input"
            value={values.strategy}
            onChange={(e) => setField('strategy', e.target.value)}
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Tags (comma-separated)</span>
          <input
            className="field-input"
            value={values.tags}
            onChange={(e) => setField('tags', e.target.value)}
          />
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
  submitting: PropTypes.bool
};

TradeForm.defaultProps = {
  defaultValues: initialValues,
  submitting: false
};

export default TradeForm;
