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
  const { data } = await http.get('/deep-dive/status');
  return data;
};

export const fetchDeepDiveImports = async ({ q = '', page = 1, pageSize = 100 } = {}) => {
  const { data } = await http.get('/deep-dive/imports', {
    params: {
      q,
      page,
      pageSize
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
