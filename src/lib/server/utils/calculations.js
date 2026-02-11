const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round = (value, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const EPSILON_QTY = 1e-9;

const buildEntries = (trade) => {
  const base = {
    label: 'BASE',
    entryDate: trade.entryDate,
    entryPrice: toNumber(trade.entryPrice),
    qty: toNumber(trade.entryQty),
    stopLoss: toNumber(trade.stopLoss)
  };

  const pyramids = (trade.pyramids || []).map((pyramid) => ({
    label: 'PYRAMID',
    entryDate: pyramid.entryDate || pyramid.date,
    entryPrice: toNumber(pyramid.price),
    qty: toNumber(pyramid.qty),
    stopLoss: toNumber(pyramid.stopLoss)
  }));

  return [base, ...pyramids].sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));
};

const calcWeightedAvgEntryPrice = (entries) => {
  const totals = entries.reduce(
    (acc, entry) => {
      const qty = toNumber(entry.qty);
      acc.qty += qty;
      acc.notional += toNumber(entry.entryPrice) * qty;
      return acc;
    },
    { qty: 0, notional: 0 }
  );

  if (!totals.qty) return 0;
  return totals.notional / totals.qty;
};

const calcWeightedStopLossPercent = (entries) => {
  const totals = entries.reduce(
    (acc, entry) => {
      const qty = toNumber(entry.qty);
      const entryPrice = toNumber(entry.entryPrice);
      const stopLoss = toNumber(entry.stopLoss);
      if (qty <= 0 || entryPrice <= 0 || stopLoss <= 0) return acc;
      acc.notional += entryPrice * qty;
      acc.risk += Math.abs(entryPrice - stopLoss) * qty;
      return acc;
    },
    { notional: 0, risk: 0 }
  );
  if (!totals.notional) return 0;
  return (totals.risk / totals.notional) * 100;
};

const calcNormalizedRFromStopLoss = (trade, entriesInput = null) => {
  const entries = entriesInput || buildEntries(trade);
  const totalNotional = entries.reduce(
    (sum, entry) => sum + toNumber(entry.entryPrice) * toNumber(entry.qty),
    0
  );
  const gainPercent =
    totalNotional > 0 ? (toNumber(trade?.metrics?.realizedPnL) / totalNotional) * 100 : 0;
  const slPercent = calcWeightedStopLossPercent(entries);
  if (!slPercent) return 0;
  const rawR = gainPercent / slPercent;
  return rawR <= -1 ? -1 : rawR;
};

const diffInCalendarDaysInclusive = (start, end) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const startUtc = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const endUtc = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const diffDays = Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays) + 1;
};

const getTradeHoldingDays = (trade) => {
  const entryDate = trade?.entryDate;
  if (!entryDate) return 0;
  const exits = trade?.exits || [];
  if (!exits.length) return diffInCalendarDaysInclusive(entryDate, new Date());
  const lastExitDate = exits.reduce((latest, exit) => {
    const latestTime = latest ? new Date(latest).getTime() : -Infinity;
    const currentTime = new Date(exit.exitDate).getTime();
    return currentTime > latestTime ? exit.exitDate : latest;
  }, null);
  return diffInCalendarDaysInclusive(entryDate, lastExitDate || entryDate);
};

const buildFifoResult = ({ entries, exits, side }) => {
  const lots = entries.map((entry) => ({
    qtyRemaining: toNumber(entry.qty),
    entryPrice: toNumber(entry.entryPrice),
    entryDate: entry.entryDate,
    stopLoss: toNumber(entry.stopLoss)
  }));
  const sortedExits = [...(exits || [])].sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));
  const exitPnlEvents = [];
  let realizedPnL = 0;

  sortedExits.forEach((exit) => {
    let remainingExitQty = toNumber(exit.exitQty);
    const exitPrice = toNumber(exit.exitPrice);
    let exitPnl = 0;

    for (const lot of lots) {
      if (remainingExitQty <= EPSILON_QTY) break;
      if (lot.qtyRemaining <= EPSILON_QTY) continue;
      const matchedQty = Math.min(remainingExitQty, lot.qtyRemaining);
      const pnl =
        side === 'SHORT'
          ? matchedQty * (lot.entryPrice - exitPrice)
          : matchedQty * (exitPrice - lot.entryPrice);
      exitPnl += pnl;
      realizedPnL += pnl;
      lot.qtyRemaining -= matchedQty;
      remainingExitQty -= matchedQty;
    }

    exitPnlEvents.push({
      date: exit.exitDate,
      pnl: round(exitPnl, 2)
    });
  });

  const openQty = lots.reduce((acc, lot) => acc + Math.max(lot.qtyRemaining, 0), 0);
  const openNotional = lots.reduce(
    (acc, lot) => acc + Math.max(lot.qtyRemaining, 0) * lot.entryPrice,
    0
  );
  const avgOpenEntryPrice = openQty > EPSILON_QTY ? openNotional / openQty : 0;
  const openLots = lots
    .filter((lot) => lot.qtyRemaining > EPSILON_QTY)
    .map((lot) => ({
      qty: lot.qtyRemaining,
      entryPrice: lot.entryPrice,
      stopLoss: lot.stopLoss
    }));

  return {
    realizedPnL,
    openQty,
    avgOpenEntryPrice,
    exitPnlEvents,
    openLots
  };
};

const calcOpenCapitalAtRisk = (openLots, stopLossAdjustments) => {
  if (!openLots.length) return 0;
  let segments = openLots.map((lot) => ({
    qty: toNumber(lot.qty),
    entryPrice: toNumber(lot.entryPrice),
    stopLoss: toNumber(lot.stopLoss),
    isAdjusted: false,
    adjustedAt: null
  }));

  const adjustments = [...(stopLossAdjustments || [])].sort(
    (a, b) => new Date(a.date || 0) - new Date(b.date || 0)
  );

  for (const adjustment of adjustments) {
    let remainingQty = toNumber(adjustment.qty);
    const adjustedStopLoss = toNumber(adjustment.stopLoss);
    if (remainingQty <= EPSILON_QTY || adjustedStopLoss <= 0) continue;

    const adjustedSegments = segments
      .filter((segment) => segment.isAdjusted && segment.qty > EPSILON_QTY)
      .sort((a, b) => new Date(b.adjustedAt || 0) - new Date(a.adjustedAt || 0));
    const baseSegments = segments.filter((segment) => !segment.isAdjusted && segment.qty > EPSILON_QTY);
    const pools = [adjustedSegments, baseSegments];

    for (const pool of pools) {
      for (const segment of pool) {
        if (remainingQty <= EPSILON_QTY) break;
        if (segment.qty <= EPSILON_QTY) continue;
        const matchedQty = Math.min(remainingQty, segment.qty);
        segment.qty -= matchedQty;
        remainingQty -= matchedQty;
        segments.push({
          qty: matchedQty,
          entryPrice: segment.entryPrice,
          stopLoss: adjustedStopLoss,
          isAdjusted: true,
          adjustedAt: adjustment.date || new Date()
        });
      }
      if (remainingQty <= EPSILON_QTY) break;
    }

    segments = segments.filter((segment) => segment.qty > EPSILON_QTY);
  }

  return segments.reduce((acc, segment) => {
    const qty = toNumber(segment.qty);
    if (qty <= EPSILON_QTY) return acc;
    return acc + Math.abs(toNumber(segment.entryPrice) - toNumber(segment.stopLoss)) * qty;
  }, 0);
};

const calcUnrealizedPnL = ({ openQty, lastPrice, avgEntryPrice, side }) => {
  if (!openQty || lastPrice === null || lastPrice === undefined || lastPrice === '') return null;
  const marketPrice = toNumber(lastPrice);
  const pnl =
    side === 'SHORT' ? openQty * (avgEntryPrice - marketPrice) : openQty * (marketPrice - avgEntryPrice);
  return pnl;
};

export const calcTradeMetrics = (trade, totalCapital = 0) => {
  const entries = buildEntries(trade);
  const totalEntryQty = entries.reduce((acc, entry) => acc + toNumber(entry.qty), 0);
  const exits = trade.exits || [];
  const exitedQty = exits.reduce((acc, exit) => acc + toNumber(exit.exitQty), 0);
  const fifo = buildFifoResult({ entries, exits, side: trade.side });
  const openQty = round(Math.max(fifo.openQty, 0), 6);
  const avgEntryPrice =
    openQty > 0 ? fifo.avgOpenEntryPrice : calcWeightedAvgEntryPrice(entries);
  const capitalAtRisk =
    openQty > EPSILON_QTY
      ? calcOpenCapitalAtRisk(fifo.openLots, trade.stopLossAdjustments)
      : 0;
  const realizedPnL = fifo.realizedPnL;
  const charges = toNumber(trade.charges);
  const netRealizedPnL = realizedPnL - charges;
  const unrealizedPnL = calcUnrealizedPnL({
    openQty,
    lastPrice: trade.lastPrice,
    avgEntryPrice,
    side: trade.side
  });

  const realizedR = capitalAtRisk ? realizedPnL / capitalAtRisk : 0;
  const netRealizedR = capitalAtRisk ? netRealizedPnL / capitalAtRisk : 0;
  const status = openQty > 0 ? 'OPEN' : 'CLOSED';
  const riskPercent = totalCapital > 0 ? (capitalAtRisk / totalCapital) * 100 : 0;

  return {
    totalEntryQty: round(totalEntryQty, 6),
    avgEntryPrice: round(avgEntryPrice, 4),
    openQty,
    exitedQty: round(exitedQty, 6),
    capitalAtRisk: round(capitalAtRisk, 2),
    riskPercent: round(riskPercent, 2),
    realizedPnL: round(netRealizedPnL, 2),
    grossRealizedPnL: round(realizedPnL, 2),
    charges: round(charges, 2),
    unrealizedPnL: unrealizedPnL === null ? null : round(unrealizedPnL, 2),
    realizedR: round(netRealizedR, 4),
    grossRealizedR: round(realizedR, 4),
    status
  };
};

export const buildDashboardAnalytics = (trades) => {
  const closedTrades = trades.filter((trade) => trade.metrics.status === 'CLOSED');
  const openPositionKeys = new Set(
    trades
      .filter((trade) => trade.metrics.status === 'OPEN')
      .map((trade) => `${trade.symbol}__${trade.side}`)
  );
  const totalRealizedPnL = trades.reduce((acc, trade) => acc + trade.metrics.realizedPnL, 0);

  const equityPoints = [];
  const monthlyMap = {};

  const exitEvents = [];
  trades.forEach((trade) => {
    const entries = buildEntries(trade);
    const fifo = buildFifoResult({ entries, exits: trade.exits || [], side: trade.side });
    fifo.exitPnlEvents.forEach((event) => {
      const parsedDate = new Date(event.date);
      if (Number.isNaN(parsedDate.getTime())) return;

      exitEvents.push({
        date: parsedDate,
        pnl: event.pnl
      });
    });
  });

  exitEvents.sort((a, b) => a.date - b.date);

  let runningEquity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  exitEvents.forEach((event) => {
    runningEquity += event.pnl;
    equityPoints.push({
      date: event.date.toISOString().slice(0, 10),
      equity: round(runningEquity, 2)
    });

    if (runningEquity > peak) peak = runningEquity;
    const drawdown = peak - runningEquity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    const monthKey = event.date.toISOString().slice(0, 7);
    monthlyMap[monthKey] = round((monthlyMap[monthKey] || 0) + event.pnl, 2);
  });

  const monthlyPnL = Object.keys(monthlyMap)
    .sort()
    .map((month) => ({ month, pnl: monthlyMap[month] }));

  const closedWins = closedTrades.filter((trade) => trade.metrics.realizedPnL > 0);
  const closedLosses = closedTrades.filter((trade) => trade.metrics.realizedPnL < 0);

  const grossWins = closedWins.reduce((acc, trade) => acc + trade.metrics.realizedPnL, 0);
  const grossLossesAbs = Math.abs(
    closedLosses.reduce((acc, trade) => acc + trade.metrics.realizedPnL, 0)
  );

  const avgWinner = closedWins.length ? grossWins / closedWins.length : 0;
  const avgLoser = closedLosses.length
    ? closedLosses.reduce((acc, trade) => acc + trade.metrics.realizedPnL, 0) / closedLosses.length
    : 0;

  const avgR = closedTrades.length
    ? closedTrades.reduce((acc, trade) => {
        const entries = buildEntries(trade);
        return acc + calcNormalizedRFromStopLoss(trade, entries);
      }, 0) / closedTrades.length
    : 0;
  const avgHoldingDays = closedTrades.length
    ? closedTrades.reduce((acc, trade) => acc + getTradeHoldingDays(trade), 0) / closedTrades.length
    : 0;
  const winningTrades = closedWins
    .map((trade) => {
      const exits = trade.exits || [];
      const lastExitDate = exits.length
        ? exits.reduce((latest, exit) => {
            const latestTime = latest ? new Date(latest).getTime() : -Infinity;
            const currentTime = new Date(exit.exitDate).getTime();
            return currentTime > latestTime ? exit.exitDate : latest;
          }, null)
        : null;

      return {
        id: trade._id,
        symbol: trade.symbol,
        side: trade.side,
        realizedPnL: round(trade.metrics.realizedPnL, 2),
        realizedR: round(calcNormalizedRFromStopLoss(trade), 4),
        closedOn: lastExitDate || trade.updatedAt || trade.entryDate
      };
    })
    .sort((a, b) => new Date(b.closedOn) - new Date(a.closedOn));

  return {
    summary: {
      totalRealizedPnL: round(totalRealizedPnL, 2),
      monthlyRealizedPnL: monthlyPnL.length ? monthlyPnL[monthlyPnL.length - 1].pnl : 0,
      winRate: closedTrades.length ? round((closedWins.length / closedTrades.length) * 100, 2) : 0,
      avgR: round(avgR, 4),
      avgHoldingDays: round(avgHoldingDays, 2),
      expectancy: round(avgR, 4),
      avgWinner: round(avgWinner, 2),
      avgLoser: round(avgLoser, 2),
      profitFactor: grossLossesAbs ? round(grossWins / grossLossesAbs, 4) : 0,
      maxDrawdown: round(maxDrawdown, 2),
      tradesCount: trades.length,
      openTradesCount: openPositionKeys.size
    },
    winningTrades,
    equityCurve: equityPoints,
    monthlyPnL
  };
};
