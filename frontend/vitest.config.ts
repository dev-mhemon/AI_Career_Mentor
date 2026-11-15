import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  cacheDir: path.resolve(__dirname, './node_modules/.vite'),
  plugins: [react()],
  test: {
    cache: false,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
