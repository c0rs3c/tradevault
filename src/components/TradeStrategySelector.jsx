import PropTypes from 'prop-types';
import { STRATEGY_OPTIONS } from '../utils/tradeOptions';

const TradeStrategySelector = ({ value = [], onToggle, label = 'Strategy', className = '' }) => (
  <label className={`space-y-1 ${className}`}>
    <span className="text-sm font-medium">{label}</span>
    <div className="flex flex-wrap gap-2">
      {STRATEGY_OPTIONS.map((option) => {
        const isSelected = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
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
);

TradeStrategySelector.propTypes = {
  value: PropTypes.arrayOf(PropTypes.string),
  onToggle: PropTypes.func.isRequired,
  label: PropTypes.string,
  className: PropTypes.string
};

TradeStrategySelector.defaultProps = {
  value: [],
  label: 'Strategy',
  className: ''
};

export default TradeStrategySelector;
