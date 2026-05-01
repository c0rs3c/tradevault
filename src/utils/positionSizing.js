export const POSITION_SIZING_MODES = [
  { id: 'RISK_PERCENT', label: 'Capital At Risk', isPercent: true, category: 'risk' },
  { id: 'ALLOCATION_PERCENT', label: 'Allocation Based', isPercent: true, category: 'allocation' }
];

export const getDefaultPositionSizingState = (settings) => {
  return {
    side: 'LONG',
    entryPrice: '',
    stopLoss: '',
    sizingMode: 'RISK_PERCENT',
    sizingValue: '0.3'
  };
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
};

export const calculatePositionSizing = ({
  side,
  entryPrice,
  stopLoss,
  sizingMode,
  sizingValue,
  totalCapital
}) => {
  const parsedEntryPrice = toNumber(entryPrice);
  const parsedStopLoss = toNumber(stopLoss);
  const parsedSizingValue = toNumber(sizingValue);
  const parsedTotalCapital = toNumber(totalCapital);
  const hasCapital = Number.isFinite(parsedTotalCapital) && parsedTotalCapital > 0;

  const errors = {};

  if (!(parsedEntryPrice > 0)) {
    errors.entryPrice = 'Enter a valid entry price greater than 0.';
  }
  if (!(parsedStopLoss > 0)) {
    errors.stopLoss = 'Enter a valid stop loss greater than 0.';
  }
  if (!(parsedSizingValue > 0)) {
    errors.sizingValue = 'Enter a sizing value greater than 0.';
  }
  if (
    (sizingMode === 'RISK_PERCENT' || sizingMode === 'ALLOCATION_PERCENT') &&
    !hasCapital
  ) {
    errors.totalCapital = 'Set Total Capital in Settings to use percentage-based sizing.';
  }

  const perUnitRisk =
    parsedEntryPrice > 0 && parsedStopLoss > 0 ? Math.abs(parsedEntryPrice - parsedStopLoss) : NaN;
  const stopLossDistancePercent =
    parsedEntryPrice > 0 && parsedStopLoss > 0 ? (perUnitRisk / parsedEntryPrice) * 100 : NaN;

  if (sizingMode === 'RISK_PERCENT' && !(perUnitRisk > 0)) {
    errors.stopLossDistance = 'Risk-based sizing requires entry and stop loss to be different.';
  }

  const result = {
    side: String(side || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG',
    entryPrice: parsedEntryPrice,
    stopLoss: parsedStopLoss,
    sizingMode,
    sizingValue: parsedSizingValue,
    totalCapital: parsedTotalCapital,
    perUnitRisk,
    stopLossDistancePercent,
    recommendedQty: NaN,
    positionValue: NaN,
    capitalAtRisk: NaN,
    riskPercentOfCapital: NaN,
    allocationPercentOfCapital: NaN,
    riskAmount: NaN,
    allocationAmount: NaN,
    errors,
    warnings: []
  };

  if (Object.keys(errors).length) {
    return result;
  }

  if (sizingMode === 'RISK_PERCENT') {
    result.riskAmount = (parsedTotalCapital * parsedSizingValue) / 100;
    result.recommendedQty = result.riskAmount / perUnitRisk;
  } else if (sizingMode === 'ALLOCATION_PERCENT') {
    result.allocationAmount = (parsedTotalCapital * parsedSizingValue) / 100;
    result.recommendedQty = result.allocationAmount / parsedEntryPrice;
  }

  result.positionValue = result.recommendedQty * parsedEntryPrice;
  result.capitalAtRisk = result.recommendedQty * perUnitRisk;
  result.riskAmount = Number.isFinite(result.riskAmount) ? result.riskAmount : result.capitalAtRisk;
  result.allocationAmount = Number.isFinite(result.allocationAmount)
    ? result.allocationAmount
    : result.positionValue;
  result.riskPercentOfCapital = hasCapital ? (result.capitalAtRisk / parsedTotalCapital) * 100 : NaN;
  result.allocationPercentOfCapital = hasCapital ? (result.positionValue / parsedTotalCapital) * 100 : NaN;

  if (!(result.recommendedQty > 0)) {
    result.errors.recommendedQty = 'Could not compute a valid quantity from the current inputs.';
    return result;
  }

  const warningRiskPercent = hasCapital
    ? Number.isFinite(toNumber(result.riskPercentOfCapital)) &&
      result.riskPercentOfCapital > 5
    : false;
  if (
    sizingMode === 'ALLOCATION_PERCENT' &&
    warningRiskPercent
  ) {
    result.warnings.push('This allocation implies account risk above 5% based on the current stop loss.');
  }

  if (
    sizingMode === 'RISK_PERCENT' &&
    hasCapital &&
    result.positionValue > parsedTotalCapital
  ) {
    result.warnings.push('This risk-based size requires allocation above your total capital.');
  }

  return result;
};
