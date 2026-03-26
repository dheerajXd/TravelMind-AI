const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

const buildUrl = (path, params) => {
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const query = params
    ? Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
    : '';

  return query ? `${normalizedBase}${normalizedPath}?${query}` : `${normalizedBase}${normalizedPath}`;
};

export const requestJson = async (path, options = {}) => {
  const { method = 'GET', params, body, headers = {} } = options;
  const requestUrl = buildUrl(path, params);
  const response = await fetch(requestUrl, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.detail || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    error.url = requestUrl;
    throw error;
  }

  return data;
};

export const getApiBaseUrl = () => API_BASE_URL;
