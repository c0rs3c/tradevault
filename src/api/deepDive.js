import http from './http';

export const fetchDeepDiveLists = async () => {
  const { data } = await http.get('/deep-dive/lists');
  return data;
};

export const createDeepDiveList = async ({ title, description, text }) => {
  const { data } = await http.post('/deep-dive/lists', { title, description, text });
  return data;
};

export const fetchDeepDiveListDetails = async (id) => {
  const { data } = await http.get(`/deep-dive/lists/${id}`);
  return data;
};

export const updateDeepDiveList = async (id, payload) => {
  const { data } = await http.put(`/deep-dive/lists/${id}`, payload);
  return data;
};

export const deleteDeepDiveList = async (id) => {
  const { data } = await http.delete(`/deep-dive/lists/${id}`);
  return data;
};

export const fetchDeepDiveStatus = async () => {
  const { data } = await http.get('/deep-dive/status', {
    params: { _ts: Date.now() }
  });
  return data;
};

export const fetchDeepDiveImports = async ({ q = '', page = 1, pageSize = 100, asOfDate = '' } = {}) => {
  const { data } = await http.get('/deep-dive/imports', {
    params: {
      q,
      page,
      pageSize,
      asOfDate,
      _ts: Date.now()
    }
  });
  return data;
};

export const triggerDeepDiveSync = async (payload) => {
  const { data } = await http.post('/deep-dive/sync', payload || {});
  return data;
};

export const fetchDeepDiveErrors = async ({ q = '', page = 1, pageSize = 100 } = {}) => {
  const { data } = await http.get('/deep-dive/errors', {
    params: {
      q,
      page,
      pageSize
    }
  });
  return data;
};

export const fetchDeepDiveRs = async (payload) => {
  const { data } = await http.post('/deep-dive/rs', payload);
  return data;
};

export const fetchDeepDiveSectorAnalysis = async (payload) => {
  const { data } = await http.post('/deep-dive/analysis/sector', payload);
  return data;
};

export const fetchEarningsShareholdingDeepDive = async (symbol) => {
  const { data } = await http.get('/deep-dive/earnings-shareholding', {
    params: { symbol, _ts: Date.now() }
  });
  return data;
};

export const searchEarningsShareholdingCompanies = async (query, limit = 10) => {
  const { data } = await http.get('/deep-dive/earnings-shareholding', {
    params: { q: query, limit, _ts: Date.now() }
  });
  return data;
};

export const listEarningsShareholdingCompanies = async () => {
  const { data } = await http.get('/deep-dive/earnings-shareholding', {
    params: { mode: 'list', _ts: Date.now() }
  });
  return data;
};

export const listEarningsShareholdingPeriods = async () => {
  const { data } = await http.get('/deep-dive/earnings-shareholding', {
    params: { mode: 'periods', _ts: Date.now() }
  });
  return data;
};

export const fetchEarningsShareholdingSummary = async ({
  symbol = '',
  quarters = [],
  minMarketCapCr = '',
  maxMarketCapCr = '',
  minRupeeVolumeCr = '',
  maxRupeeVolumeCr = '',
  minPrice = '',
  maxPrice = '',
  columnFilters = {}
} = {}) => {
  const { data } = await http.get('/deep-dive/earnings-shareholding', {
    params: {
      mode: 'summary',
      symbol,
      quarters: Array.isArray(quarters) ? quarters.join(',') : quarters,
      minMarketCapCr,
      maxMarketCapCr,
      minRupeeVolumeCr,
      maxRupeeVolumeCr,
      minPrice,
      maxPrice,
      columnFilters: JSON.stringify(columnFilters || {}),
      _ts: Date.now()
    }
  });
  return data;
};

export const fetchNseUniverseSnapshot = async ({
  q = '',
  selectedDate = '',
  minMarketCapCr = '',
  maxMarketCapCr = '',
  minRupeeVolumeCr = '',
  maxRupeeVolumeCr = '',
  page = 1,
  pageSize = 100
} = {}) => {
  const { data } = await http.get('/deep-dive/nse-universe', {
    params: {
      q,
      selectedDate,
      minMarketCapCr,
      maxMarketCapCr,
      minRupeeVolumeCr,
      maxRupeeVolumeCr,
      page,
      pageSize,
      _ts: Date.now()
    }
  });
  return data;
};

export const fetchNseUniverseSyncStatus = async () => {
  const { data } = await http.get('/deep-dive/nse-universe', {
    params: {
      mode: 'status',
      _ts: Date.now()
    }
  });
  return data;
};

export const searchNseUniverseSymbols = async (query, limit = 12) => {
  const { data } = await http.get('/deep-dive/nse-universe', {
    params: {
      mode: 'suggestions',
      q: query,
      limit,
      _ts: Date.now()
    }
  });
  return data;
};

export const triggerNseUniverseSync = async (payload) => {
  const { data } = await http.post('/deep-dive/nse-universe', payload || {});
  return data;
};

export const fetchMarketBreadthDeepDive = async ({ selectedDate = '', beforeDate = '', limit = 20 } = {}) => {
  const { data } = await http.get('/deep-dive/market-breadth', {
    params: {
      selectedDate,
      beforeDate,
      limit,
      _ts: Date.now()
    }
  });
  return data;
};
