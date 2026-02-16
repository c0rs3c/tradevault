import http from './http';

export const fetchSymbols = async () => {
  const { data } = await http.get('/symbols');
  return data;
};

export const refreshSymbols = async () => {
  const { data } = await http.post('/symbols/refresh');
  return data;
};
