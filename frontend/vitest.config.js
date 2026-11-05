import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['frontend/src/**/*.test.jsx'],
    setupFiles: ['frontend/src/test/setup.js'],
  },
});
