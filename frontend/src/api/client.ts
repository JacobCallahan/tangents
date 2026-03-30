/**
 * Axios API client — all requests go through this instance.
 * Credentials (Basic auth) are injected from localStorage on each request.
 */

import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Inject Basic auth header from localStorage before every request
apiClient.interceptors.request.use((config) => {
  const credentials = localStorage.getItem('tangents_credentials');
  if (credentials) {
    config.headers['Authorization'] = `Basic ${credentials}`;
  }
  return config;
});

// On 401, clear stored credentials so the login gate re-appears
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('tangents_credentials');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);
