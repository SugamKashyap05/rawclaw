import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const appRoot = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  root: appRoot,
  resolve: {
    alias: {
      '@rawclaw/shared': path.resolve(appRoot, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent/, ''),
      },
    },
  },
  test: {
    root: appRoot,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
    exclude: ['**/.pytest_cache/**'],
  },
});
