import PropTypes from 'prop-types';

const SummaryCard = ({ label, value, valueClassName = '', className = '' }) => {
  const valueClasses = valueClassName
    ? `mt-2 text-xl font-semibold ${valueClassName}`
    : 'mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100';

  return (
    <div className={`surface-card rounded-lg p-4 ${className}`}>
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className={valueClasses}>{value}</p>
    </div>
  );
};

SummaryCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  valueClassName: PropTypes.string,
  className: PropTypes.string
};

export default SummaryCard;
