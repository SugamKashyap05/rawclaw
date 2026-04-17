import axios from 'axios';
import { AUTH_TOKEN_KEY } from './auth';

export const api = axios.create({
  baseURL: '/api'
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

api.interceptors.response.use((response) => {
  return response;
}, (error) => {
  if (error.response?.status === 401) {
    console.error('Authentication Error: 401 Unauthorized');
    // We could emit an event here to show a login modal if needed.
  }
  return Promise.reject(error);
});
