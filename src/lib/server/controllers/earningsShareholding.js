import { normalizeScreenerSymbol, queryScreenerPostgres } from '@/lib/server/postgres';

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const maybeNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseOptionalNumberParam = (value, label) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw createError(`Invalid ${label}`, 400);
  }
  return parsed;
};

const normalizeQuarterPeriodEnd = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createError('Invalid quarter', 400);
  }
  return normalized;
};

const parseSelectedQuarterEnds = (value, { allowEmpty = true } = {}) => {
  const items = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  const normalized = [...new Set(items.map(normalizeQuarterPeriodEnd))];
  if (!allowEmpty && !normalized.length) {
    throw createError('Select at least one quarter', 400);
  }
  if (normalized.length > 4) {
    throw createError('Select at most 4 quarters', 400);
  }
  return normalized;
};

const SUMMARY_FILTERABLE_METRIC_KEYS = new Set([
  'salesYoyChange',
  'netProfitYoyChange',
  'salesQoqChange',
  'netProfitQoqChange'
]);

const parseColumnFilters = (value) => {
  if (!String(value || '').trim()) return [];

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw createError('Invalid columnFilters', 400);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createError('Invalid columnFilters', 400);
  }

  return Object.entries(parsed).flatMap(([columnKey, rawRange]) => {
    const [metricKey, periodEnd] = String(columnKey || '').split('__');
    if (!SUMMARY_FILTERABLE_METRIC_KEYS.has(metricKey) || !periodEnd) {
      return [];
    }

    const normalizedPeriodEnd = normalizeQuarterPeriodEnd(periodEnd);
    const min = parseOptionalNumberParam(rawRange?.min, `${columnKey} min`);
    const max = parseOptionalNumberParam(rawRange?.max, `${columnKey} max`);
    if (min === null && max === null) return [];

    return [{
      columnKey,
      metricKey,
      periodEnd: normalizedPeriodEnd,
      min,
      max
    }];
  });
};

const formatQuarterlyRow = (row) => ({
  symbol: row.symbol || '',
  companySlug: row.company_slug || '',
  periodLabel: row.period_label || '',
  periodEnd: row.period_end || '',
  earningsDate: row.earnings_date || '',
  salesRsCr: maybeNumber(row.sales_rs_cr),
  netProfitRsCr: maybeNumber(row.net_profit_rs_cr),
  epsRs: maybeNumber(row.eps_rs),
  opmPercent: maybeNumber(row.opm_percent),
  sourceUrl: row.source_url || '',
  updatedAt: row.updated_at || ''
});

const formatShareholdingRow = (row) => ({
  symbol: row.symbol || '',
  companySlug: row.company_slug || '',
  viewType: row.view_type || '',
  periodLabel: row.period_label || '',
  periodEnd: row.period_end || '',
  holdersCategory: row.holders_category || '',
  holdingPercent: maybeNumber(row.holding_percent),
  shareholderCount: maybeNumber(row.shareholder_count),
  sourceUrl: row.source_url || '',
  updatedAt: row.updated_at || ''
});

export const searchEarningsShareholdingCompanies = async ({ query, limit = 10 }) => {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return { query: '', suggestions: [] };

  const cappedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  const likeQuery = `%${normalizedQuery}%`;

  const result = await queryScreenerPostgres(
    `
      SELECT symbol, company_name
      FROM screener_company_profiles
      WHERE symbol ILIKE $1
         OR company_name ILIKE $1
      ORDER BY
        CASE
          WHEN symbol ILIKE $2 THEN 1
          WHEN company_name ILIKE $2 THEN 2
          WHEN symbol ILIKE $3 THEN 3
          WHEN company_name ILIKE $3 THEN 4
          ELSE 5
        END,
        symbol ASC
      LIMIT $4
    `,
    [likeQuery, normalizedQuery, `${normalizedQuery}%`, cappedLimit]
  );

  return {
    query: normalizedQuery,
    suggestions: result.rows.map((row) => ({
      symbol: row.symbol || '',
      companyName: row.company_name || ''
    }))
  };
};

export const listEarningsShareholdingCompanies = async () => {
  const result = await queryScreenerPostgres(
    `
      SELECT symbol, company_name
      FROM screener_company_profiles
      ORDER BY symbol ASC
    `
  );

  return {
    suggestions: result.rows.map((row) => ({
      symbol: row.symbol || '',
      companyName: row.company_name || ''
    }))
  };
};

export const listEarningsShareholdingPeriods = async ({
  startDate = '2021-01-01',
  endDate = '2027-12-31'
} = {}) => {
  const result = await queryScreenerPostgres(
    `
      SELECT DISTINCT period_end, period_label
      FROM screener_quarterly_results
      WHERE period_end BETWEEN $1 AND $2
      ORDER BY period_end DESC
    `,
    [startDate, endDate]
  );

  return {
    periods: result.rows.map((row) => ({
      periodEnd: row.period_end || '',
      periodLabel: row.period_label || ''
    }))
  };
};

export const listEarningsShareholdingSummary = async ({
  symbol = '',
  quarters = '',
  minMarketCapCr = '',
  maxMarketCapCr = '',
  minRupeeVolumeCr = '',
  maxRupeeVolumeCr = '',
  minPrice = '',
  maxPrice = '',
  columnFilters = ''
} = {}) => {
  const parsedMinMarketCapCr = parseOptionalNumberParam(minMarketCapCr, 'minMarketCapCr');
  const parsedMaxMarketCapCr = parseOptionalNumberParam(maxMarketCapCr, 'maxMarketCapCr');
  const parsedMinRupeeVolumeCr = parseOptionalNumberParam(minRupeeVolumeCr, 'minRupeeVolumeCr');
  const parsedMaxRupeeVolumeCr = parseOptionalNumberParam(maxRupeeVolumeCr, 'maxRupeeVolumeCr');
  const parsedMinPrice = parseOptionalNumberParam(minPrice, 'minPrice');
  const parsedMaxPrice = parseOptionalNumberParam(maxPrice, 'maxPrice');
  const parsedColumnFilters = parseColumnFilters(columnFilters);
  const normalizedSymbol = String(symbol || '').trim() ? normalizeScreenerSymbol(symbol) : '';
  const selectedQuarterEnds = parseSelectedQuarterEnds(quarters);

  const params = [];
  const whereClauses = [];

  if (normalizedSymbol) {
    params.push(normalizedSymbol);
    whereClauses.push(`summary.symbol = $${params.length}`);
  }
  if (selectedQuarterEnds.length) {
    params.push(selectedQuarterEnds);
    whereClauses.push(`summary.period_end = ANY($${params.length}::date[])`);
  } else {
    whereClauses.push('summary.recency_rank <= 3');
  }
  if (parsedMinMarketCapCr !== null) {
    params.push(parsedMinMarketCapCr * 10000000);
    whereClauses.push(`COALESCE(universe.market_cap, universe.symbol_market_cap) >= $${params.length}`);
  }
  if (parsedMaxMarketCapCr !== null) {
    params.push(parsedMaxMarketCapCr * 10000000);
    whereClauses.push(`COALESCE(universe.market_cap, universe.symbol_market_cap) <= $${params.length}`);
  }
  if (parsedMinRupeeVolumeCr !== null) {
    params.push(parsedMinRupeeVolumeCr);
    whereClauses.push(`universe.rupee_volume_crore >= $${params.length}`);
  }
  if (parsedMaxRupeeVolumeCr !== null) {
    params.push(parsedMaxRupeeVolumeCr);
    whereClauses.push(`universe.rupee_volume_crore <= $${params.length}`);
  }
  if (parsedMinPrice !== null) {
    params.push(parsedMinPrice);
    whereClauses.push(`universe.close >= $${params.length}`);
  }
  if (parsedMaxPrice !== null) {
    params.push(parsedMaxPrice);
    whereClauses.push(`universe.close <= $${params.length}`);
  }
  const symbolFilterClauses = [];
  parsedColumnFilters.forEach((filter) => {
    const metricColumnMap = {
      salesYoyChange: 'sales_yoy_change',
      netProfitYoyChange: 'net_profit_yoy_change',
      salesQoqChange: 'sales_qoq_change',
      netProfitQoqChange: 'net_profit_qoq_change'
    };
    const metricColumn = metricColumnMap[filter.metricKey];
    if (!metricColumn) return;

    params.push(filter.periodEnd);
    const periodParamIndex = params.length;
    const metricClauses = [`qfc.period_end = $${periodParamIndex}::date`];

    if (filter.min !== null) {
      params.push(filter.min);
      metricClauses.push(`qfc.${metricColumn} >= $${params.length}`);
    }
    if (filter.max !== null) {
      params.push(filter.max);
      metricClauses.push(`qfc.${metricColumn} <= $${params.length}`);
    }

    symbolFilterClauses.push(`
      EXISTS (
        SELECT 1
        FROM quarterly_with_changes qfc
        WHERE qfc.symbol = summary.symbol
          AND ${metricClauses.join(' AND ')}
      )
    `);
  });

  const result = await queryScreenerPostgres(
    `
      WITH quarterly_base AS (
        SELECT
          qr.symbol,
          cp.company_name,
          qr.period_label,
          qr.period_end,
          ed.earnings_date,
          qr.sales_rs_cr,
          qr.net_profit_rs_cr,
          LAG(qr.sales_rs_cr, 4) OVER (PARTITION BY qr.symbol ORDER BY qr.period_end ASC) AS sales_prev_year,
          LAG(qr.net_profit_rs_cr, 4) OVER (PARTITION BY qr.symbol ORDER BY qr.period_end ASC) AS net_profit_prev_year,
          LAG(qr.sales_rs_cr, 1) OVER (PARTITION BY qr.symbol ORDER BY qr.period_end ASC) AS sales_prev_quarter,
          LAG(qr.net_profit_rs_cr, 1) OVER (PARTITION BY qr.symbol ORDER BY qr.period_end ASC) AS net_profit_prev_quarter,
          ROW_NUMBER() OVER (PARTITION BY qr.symbol ORDER BY qr.period_end DESC) AS recency_rank
        FROM screener_quarterly_results qr
        LEFT JOIN screener_company_profiles cp
          ON cp.symbol = qr.symbol
        LEFT JOIN screener_earnings_dates ed
          ON ed.symbol = qr.symbol
         AND ed.period_end = qr.period_end
      ),
      quarterly_with_changes AS (
        SELECT
          symbol,
          company_name,
          period_label,
          period_end,
          earnings_date,
          sales_rs_cr,
          net_profit_rs_cr,
          CASE
            WHEN sales_prev_year IS NULL OR sales_prev_year = 0 THEN NULL
            ELSE ((sales_rs_cr - sales_prev_year) / ABS(sales_prev_year)) * 100
          END AS sales_yoy_change,
          CASE
            WHEN net_profit_prev_year IS NULL OR net_profit_prev_year = 0 THEN NULL
            ELSE ((net_profit_rs_cr - net_profit_prev_year) / ABS(net_profit_prev_year)) * 100
          END AS net_profit_yoy_change,
          CASE
            WHEN sales_prev_quarter IS NULL OR sales_prev_quarter = 0 THEN NULL
            ELSE ((sales_rs_cr - sales_prev_quarter) / ABS(sales_prev_quarter)) * 100
          END AS sales_qoq_change,
          CASE
            WHEN net_profit_prev_quarter IS NULL OR net_profit_prev_quarter = 0 THEN NULL
            ELSE ((net_profit_rs_cr - net_profit_prev_quarter) / ABS(net_profit_prev_quarter)) * 100
          END AS net_profit_qoq_change,
          recency_rank
        FROM quarterly_base
      ),
      latest_universe AS (
        SELECT DISTINCT ON (bars.symbol)
          bars.symbol,
          bars.trade_date,
          bars.close,
          bars.rupee_volume_crore,
          bars.market_cap,
          symbols.market_cap AS symbol_market_cap
        FROM nse_universe_daily_bars bars
        INNER JOIN nse_universe_symbols symbols
          ON symbols.symbol = bars.symbol
        ORDER BY bars.symbol ASC, bars.trade_date DESC
      )
      SELECT
        summary.symbol,
        summary.company_name,
        summary.period_label,
        summary.period_end,
        summary.earnings_date,
        summary.sales_rs_cr,
        summary.net_profit_rs_cr,
        summary.sales_yoy_change,
        summary.net_profit_yoy_change,
        summary.sales_qoq_change,
        summary.net_profit_qoq_change,
        universe.trade_date,
        universe.close,
        COALESCE(universe.market_cap, universe.symbol_market_cap) AS market_cap,
        universe.rupee_volume_crore
      FROM quarterly_with_changes summary
      LEFT JOIN latest_universe universe
        ON universe.symbol = summary.symbol
      ${(whereClauses.length || symbolFilterClauses.length) ? `WHERE ${[...whereClauses, ...symbolFilterClauses].join(' AND ')}` : ''}
      ORDER BY summary.period_end DESC, summary.net_profit_yoy_change DESC NULLS LAST, summary.symbol ASC
    `,
    params
  );

  const stocksBySymbol = new Map();
  result.rows.forEach((row) => {
    const symbolKey = row.symbol || '';
    if (!stocksBySymbol.has(symbolKey)) {
      stocksBySymbol.set(symbolKey, {
        symbol: symbolKey,
        companyName: row.company_name || '',
        latestTradeDate: row.trade_date || '',
        latestClose: maybeNumber(row.close),
        marketCap: maybeNumber(row.market_cap),
        rupeeVolumeCrore: maybeNumber(row.rupee_volume_crore),
        metricsByPeriod: {}
      });
    }

    const stock = stocksBySymbol.get(symbolKey);
    const periodEnd = row.period_end || '';
    if (periodEnd) {
      stock.metricsByPeriod[periodEnd] = {
        periodLabel: row.period_label || '',
        earningsDate: row.earnings_date || '',
        salesRsCr: maybeNumber(row.sales_rs_cr),
        netProfitRsCr: maybeNumber(row.net_profit_rs_cr),
        salesYoyChange: maybeNumber(row.sales_yoy_change),
        netProfitYoyChange: maybeNumber(row.net_profit_yoy_change),
        salesQoqChange: maybeNumber(row.sales_qoq_change),
        netProfitQoqChange: maybeNumber(row.net_profit_qoq_change)
      };
    }
  });

  return {
    stocks: [...stocksBySymbol.values()]
  };
};

export const getEarningsShareholdingDeepDive = async ({ symbol }) => {
  const normalizedSymbol = normalizeScreenerSymbol(symbol);

  const [profilesResult, quarterlyResultsResult, shareholdingPatternResult] = await Promise.all([
    queryScreenerPostgres(
      `
      SELECT symbol, company_slug, company_name, about_text, source_url, updated_at
      FROM screener_company_profiles
      WHERE symbol = $1
      LIMIT 1
    `,
      [normalizedSymbol]
    ),
    queryScreenerPostgres(
      `
      SELECT
        qr.symbol,
        qr.company_slug,
        qr.period_label,
        qr.period_end,
        ed.earnings_date,
        qr.sales_rs_cr,
        qr.net_profit_rs_cr,
        qr.eps_rs,
        qr.opm_percent,
        qr.source_url,
        qr.updated_at
      FROM screener_quarterly_results qr
      LEFT JOIN screener_earnings_dates ed
        ON ed.symbol = qr.symbol
       AND ed.period_end = qr.period_end
      WHERE qr.symbol = $1
      ORDER BY qr.period_end DESC
      LIMIT 16
    `,
      [normalizedSymbol]
    ),
    queryScreenerPostgres(
      `
      SELECT symbol, company_slug, view_type, period_label, period_end, holders_category, holding_percent, shareholder_count, source_url, updated_at
      FROM screener_shareholding_pattern
      WHERE symbol = $1
      ORDER BY period_end DESC, holders_category ASC
      LIMIT 120
    `,
      [normalizedSymbol]
    )
  ]);

  const profiles = profilesResult.rows;
  const quarterlyResults = quarterlyResultsResult.rows;
  const shareholdingPattern = shareholdingPatternResult.rows;

  if (!profiles.length && !quarterlyResults.length && !shareholdingPattern.length) {
    throw createError(`No earnings/shareholding data found for ${normalizedSymbol}`, 404);
  }

  const profile = profiles[0]
    ? {
        symbol: profiles[0].symbol || normalizedSymbol,
        companySlug: profiles[0].company_slug || '',
        companyName: profiles[0].company_name || '',
        aboutText: profiles[0].about_text || '',
        marketCapRsCr: null,
        sector: '',
        broadIndustry: '',
        industry: '',
        sourceUrl: profiles[0].source_url || '',
        updatedAt: profiles[0].updated_at || ''
      }
    : {
        symbol: normalizedSymbol,
        companySlug: '',
        companyName: '',
        aboutText: '',
        marketCapRsCr: null,
        sector: '',
        broadIndustry: '',
        industry: '',
        sourceUrl: '',
        updatedAt: ''
      };

  return {
    symbol: normalizedSymbol,
    profile,
    quarterlyResults: quarterlyResults.map(formatQuarterlyRow),
    shareholdingPattern: shareholdingPattern.map(formatShareholdingRow),
    latestQuarter: quarterlyResults.length ? formatQuarterlyRow(quarterlyResults[0]) : null,
    latestShareholdingPeriod: shareholdingPattern.length
      ? {
          periodLabel: shareholdingPattern[0].period_label || '',
          periodEnd: shareholdingPattern[0].period_end || ''
        }
      : null
  };
};
