import http from './http';

export const fetchNewsWatchlists = async () => {
  const { data } = await http.get('/news/watchlists');
  return data;
};

export const importNewsWatchlist = async (url) => {
  const { data } = await http.post('/news/watchlists', { url });
  return data;
};

export const importNewsWatchlistText = async ({ title, text }) => {
  const { data } = await http.post('/news/watchlists', { title, text });
  return data;
};

export const fetchNewsWatchlistDetails = async (watchlistId) => {
  const { data } = await http.get(`/news/watchlists/${watchlistId}`);
  return data;
};

export const deleteNewsWatchlist = async (watchlistId) => {
  const { data } = await http.delete(`/news/watchlists/${watchlistId}`);
  return data;
};

export const syncNewsWatchlist = async (watchlistId) => {
  const { data } = await http.post(`/news/watchlists/${watchlistId}/sync`);
  return data;
};

export const syncAllNewsWatchlists = async () => {
  const { data } = await http.post('/news/sync');
  return data;
};

export const searchNewsBySymbol = async (symbol) => {
  const { data } = await http.get('/news/search', {
    params: { symbol }
  });
  return data;
};

export const searchEarningsNewsBySymbol = async (symbol) => {
  const { data } = await http.get('/news/earnings-search', {
    params: { symbol }
  });
  return data;
};

export const fetchEarningsWatchlists = async () => {
  const { data } = await http.get('/news/earnings-watchlists');
  return data;
};

export const importEarningsWatchlistText = async ({ title, text }) => {
  const { data } = await http.post('/news/earnings-watchlists', { title, text });
  return data;
};

export const fetchEarningsWatchlistDetails = async (watchlistId) => {
  const { data } = await http.get(`/news/earnings-watchlists/${watchlistId}`);
  return data;
};

export const deleteEarningsWatchlist = async (watchlistId) => {
  const { data } = await http.delete(`/news/earnings-watchlists/${watchlistId}`);
  return data;
};

export const syncEarningsWatchlist = async (watchlistId) => {
  const { data } = await http.post(`/news/earnings-watchlists/${watchlistId}/sync`);
  return data;
};
