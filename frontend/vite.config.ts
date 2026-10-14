import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const backend = process.env.ZYVORA_API_URL ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // The browser only talks to the same origin; Vite forwards /api to the FastAPI backend.
    proxy: { '/api': { target: backend, changeOrigin: false } },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy: { '/api': { target: backend, changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**'],
  },
});
