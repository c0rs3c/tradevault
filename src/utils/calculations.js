const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const EPSILON_QTY = 1e-9;

export const computeTradeMetrics = (trade, totalCapital = 0) => {
  const entries = [
    {
      entryDate: trade.entryDate,
      entryPrice: toNumber(trade.entryPrice),
      qty: toNumber(trade.entryQty),
      stopLoss: toNumber(trade.stopLoss)
    },
    ...(trade.pyramids || []).map((p) => ({
      entryDate: p.entryDate || p.date,
      entryPrice: toNumber(p.price),
      qty: toNumber(p.qty),
      stopLoss: toNumber(p.stopLoss)
    }))
  ].sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));

  const totalEntryQty = entries.reduce((acc, entry) => acc + entry.qty, 0);
  const weightedAvgEntryPrice = totalEntryQty
    ? entries.reduce((acc, entry) => acc + entry.entryPrice * entry.qty, 0) / totalEntryQty
    : 0;

  const lots = entries.map((entry) => ({
    qtyRemaining: entry.qty,
    entryPrice: entry.entryPrice
  }));
  const sortedExits = [...(trade.exits || [])].sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));
  let realizedPnL = 0;
  sortedExits.forEach((exit) => {
    let remainingExitQty = toNumber(exit.exitQty);
    const exitPrice = toNumber(exit.exitPrice);
    for (const lot of lots) {
      if (remainingExitQty <= EPSILON_QTY) break;
      if (lot.qtyRemaining <= EPSILON_QTY) continue;
      const matchedQty = Math.min(remainingExitQty, lot.qtyRemaining);
      const pnl =
        trade.side === 'SHORT'
          ? matchedQty * (lot.entryPrice - exitPrice)
          : matchedQty * (exitPrice - lot.entryPrice);
      realizedPnL += pnl;
      lot.qtyRemaining -= matchedQty;
      remainingExitQty -= matchedQty;
    }
  });

  const openQtyRaw = lots.reduce((acc, lot) => acc + Math.max(lot.qtyRemaining, 0), 0);
  const openNotional = lots.reduce(
    (acc, lot) => acc + Math.max(lot.qtyRemaining, 0) * lot.entryPrice,
    0
  );
  const openQty = Math.max(openQtyRaw, 0);
  const exitedQty = (trade.exits || []).reduce((acc, exit) => acc + toNumber(exit.exitQty), 0);
  const avgEntryPrice = openQty > EPSILON_QTY ? openNotional / openQty : weightedAvgEntryPrice;

  const capitalAtRisk = entries.reduce(
    (acc, entry) => acc + Math.abs(entry.entryPrice - entry.stopLoss) * entry.qty,
    0
  );

  const charges = toNumber(trade.charges);
  const netRealizedPnL = realizedPnL - charges;

  const riskPercent = totalCapital > 0 ? (capitalAtRisk / totalCapital) * 100 : 0;

  return {
    totalEntryQty,
    avgEntryPrice,
    openQty,
    capitalAtRisk,
    realizedPnL: netRealizedPnL,
    grossRealizedPnL: realizedPnL,
    charges,
    realizedR: capitalAtRisk ? netRealizedPnL / capitalAtRisk : 0,
    riskPercent,
    status: openQty > 0 ? 'OPEN' : 'CLOSED'
  };
};
