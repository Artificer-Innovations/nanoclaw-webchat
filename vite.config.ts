import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webchatApiTarget = process.env.WEBCHAT_API_TARGET ?? 'http://127.0.0.1:3200';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: webchatApiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
