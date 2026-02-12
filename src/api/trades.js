import http from './http';

export const fetchTrades = async () => {
  const { data } = await http.get('/trades');
  return data;
};

export const fetchTrade = async (id) => {
  const { data } = await http.get(`/trades/${id}`);
  return data;
};

export const createTrade = async (payload) => {
  const { data } = await http.post('/trades', payload);
  return data;
};

export const updateTrade = async (id, payload) => {
  const { data } = await http.put(`/trades/${id}`, payload);
  return data;
};

export const deleteTrade = async (id) => {
  await http.delete(`/trades/${id}`);
};

export const addPyramid = async (id, payload) => {
  const { data } = await http.post(`/trades/${id}/pyramids`, payload);
  return data;
};

export const updatePyramid = async (id, pid, payload) => {
  const { data } = await http.put(`/trades/${id}/pyramids/${pid}`, payload);
  return data;
};

export const deletePyramid = async (id, pid) => {
  const { data } = await http.delete(`/trades/${id}/pyramids/${pid}`);
  return data;
};

export const addExit = async (id, payload) => {
  const { data } = await http.post(`/trades/${id}/exits`, payload);
  return data;
};

export const updateExit = async (id, eid, payload) => {
  const { data } = await http.put(`/trades/${id}/exits/${eid}`, payload);
  return data;
};

export const deleteExit = async (id, eid) => {
  const { data } = await http.delete(`/trades/${id}/exits/${eid}`);
  return data;
};

export const addStopLossAdjustment = async (id, payload) => {
  const { data } = await http.post(`/trades/${id}/stop-loss-adjustments`, payload);
  return data;
};

export const fetchDashboard = async () => {
  const { data } = await http.get('/trades/dashboard');
  return data;
};

export const fetchTradeQuote = async (id, signal) => {
  const { data } = await http.get(`/trades/${id}/quote`, { signal, timeout: 12000 });
  return data;
};

export const fetchMarketCandles = async ({ symbol, from, to, interval, expectedPrice, signal }) => {
  const { data } = await http.get('/market/candles', {
    params: { symbol, from, to, interval, expectedPrice },
    signal,
    timeout: 15000
  });
  return data;
};

export const importZerodhaTrades = async (csvText, fileName = '') => {
  const { data } = await http.post('/trades/import/zerodha', { csvText, fileName });
  return data;
};

export const importDhanTrades = async (csvText, fileName = '') => {
  const { data } = await http.post('/trades/import/dhan', { csvText, fileName });
  return data;
};

export const fetchTradeImports = async () => {
  const { data } = await http.get('/trades/imports');
  return data;
};

export const fetchTradeImport = async (importId) => {
  const { data } = await http.get(`/trades/imports/${importId}`);
  return data;
};

export const deleteTradeImport = async (importId) => {
  const { data } = await http.delete(`/trades/imports/${importId}`);
  return data;
};
