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
    sizingValue: '0.3',
    brokeragePercent: '0.2',
    includeBrokerage: true
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
  brokeragePercent,
  includeBrokerage,
  totalCapital
}) => {
  const parsedEntryPrice = toNumber(entryPrice);
  const parsedStopLoss = toNumber(stopLoss);
  const parsedSizingValue = toNumber(sizingValue);
  const parsedBrokeragePercent = toNumber(brokeragePercent);
  const parsedTotalCapital = toNumber(totalCapital);
  const hasCapital = Number.isFinite(parsedTotalCapital) && parsedTotalCapital > 0;
  const brokerageIncluded = includeBrokerage !== false;

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
  if (brokeragePercent !== '' && !(parsedBrokeragePercent >= 0)) {
    errors.brokeragePercent = 'Enter a valid brokerage percentage of 0 or more.';
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
    brokeragePercent: parsedBrokeragePercent,
    includeBrokerage: brokerageIncluded,
    totalCapital: parsedTotalCapital,
    perUnitRisk,
    stopLossDistancePercent,
    recommendedQty: NaN,
    positionValue: NaN,
    capitalAtRisk: NaN,
    brokerageAmount: NaN,
    totalRiskWithBrokerage: NaN,
    totalCostWithBrokerage: NaN,
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

  const brokerageRate = brokerageIncluded ? parsedBrokeragePercent / 100 : 0;

  if (sizingMode === 'RISK_PERCENT') {
    result.riskAmount = (parsedTotalCapital * parsedSizingValue) / 100;
    result.recommendedQty = result.riskAmount / (perUnitRisk + parsedEntryPrice * brokerageRate);
  } else if (sizingMode === 'ALLOCATION_PERCENT') {
    result.allocationAmount = (parsedTotalCapital * parsedSizingValue) / 100;
    result.recommendedQty = result.allocationAmount / (parsedEntryPrice * (1 + brokerageRate));
  }

  if (!(result.recommendedQty > 0)) {
    result.errors.recommendedQty = 'Could not compute a valid quantity from the current inputs.';
    return result;
  }

  result.positionValue = result.recommendedQty * parsedEntryPrice;
  result.capitalAtRisk = result.recommendedQty * perUnitRisk;
  result.brokerageAmount = result.positionValue * brokerageRate;
  result.totalRiskWithBrokerage = result.capitalAtRisk + result.brokerageAmount;
  result.totalCostWithBrokerage = result.positionValue + result.brokerageAmount;
  result.riskAmount = Number.isFinite(result.riskAmount) ? result.riskAmount : result.totalRiskWithBrokerage;
  result.allocationAmount = Number.isFinite(result.allocationAmount)
    ? result.allocationAmount
    : result.totalCostWithBrokerage;
  result.riskPercentOfCapital = hasCapital ? (result.totalRiskWithBrokerage / parsedTotalCapital) * 100 : NaN;
  result.allocationPercentOfCapital = hasCapital ? (result.totalCostWithBrokerage / parsedTotalCapital) * 100 : NaN;

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
    result.totalCostWithBrokerage > parsedTotalCapital
  ) {
    result.warnings.push('This risk-based size requires allocation above your total capital.');
  }

  return result;
};
