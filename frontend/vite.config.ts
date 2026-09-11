import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the local backend, so the frontend code uses a
// relative path and needs no change between development and the packaged app,
// where Tauri serves the built files and the backend answers on the same origin.
const BACKEND = process.env.JOB_HUNTER_BACKEND ?? 'http://127.0.0.1:8756';

export default defineConfig({
  plugins: [react()],
  // Tauri loads the bundle from a file-like origin, so assets must be relative.
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'chrome110',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
