import http from './http';

export const fetchSettings = async () => {
  const { data } = await http.get('/settings');
  return data;
};

export const saveSettings = async (payload) => {
  const { data } = await http.put('/settings', payload);
  return data;
};
