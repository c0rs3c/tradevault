import PropTypes from 'prop-types';
import { EXIT_REASON_OPTIONS } from '../utils/tradeOptions';

const ExitReasonMultiSelect = ({ value = [], onToggle, label = 'Exit Reasons', className = '' }) => {
  const summaryText = value.length ? value.join(', ') : 'Select exit reasons';

  return (
    <label className={`space-y-1 ${className}`}>
      <span className="text-sm font-medium">{label}</span>
      <details className="group rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-slate-700 marker:hidden dark:text-slate-200">
          <span className={value.length ? '' : 'text-slate-500 dark:text-slate-400'}>{summaryText}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
          {EXIT_REASON_OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={value.includes(option)}
                onChange={() => onToggle(option)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </details>
    </label>
  );
};

ExitReasonMultiSelect.propTypes = {
  value: PropTypes.arrayOf(PropTypes.string),
  onToggle: PropTypes.func.isRequired,
  label: PropTypes.string,
  className: PropTypes.string
};

ExitReasonMultiSelect.defaultProps = {
  value: [],
  label: 'Exit Reasons',
  className: ''
};

export default ExitReasonMultiSelect;
