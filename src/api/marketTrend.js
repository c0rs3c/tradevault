import http from './http';

export const fetchMarketTrendDashboard = async () => {
  const { data } = await http.get('/market-trend');
  return data;
};

export const syncMarketTrendDashboard = async (mode = 'incremental') => {
  const { data } = await http.post('/market-trend/sync', { mode });
  return data;
};
