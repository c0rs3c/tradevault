export const STRATEGY_OPTIONS = ['In the Base', 'Outside Base', 'Expansion', 'Reversal'];

export const EXIT_REASON_OPTIONS = ['SL', 'No follow through', 'squatted', 'market bad', 'profit booking'];

export const normalizeOptionList = (value) => {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
};

export const joinOptionList = (value) => normalizeOptionList(value).join(', ');

export const hasAnySelectedOption = (sourceValue, selectedValues) => {
  const selected = normalizeOptionList(selectedValues);
  if (!selected.length) return true;

  const available = new Set(normalizeOptionList(sourceValue).map((item) => item.toLowerCase()));
  return selected.some((item) => available.has(item.toLowerCase()));
};
