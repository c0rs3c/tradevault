import http from './http';

export const fetchSymbolOverview = async (symbol, signal) => {
  const { data } = await http.get('/symbol-profile', {
    params: { symbol, _ts: Date.now() },
    signal
  });
  return data;
};
