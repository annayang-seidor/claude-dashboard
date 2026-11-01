import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { SERVER_HOST, SERVER_PORT } from './src/shared/config.ts';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin rewrites Host to 127.0.0.1:4317 so the server's Host check passes.
      // Trailing slash: a bare '/api' prefix would also proxy the /api.ts module.
      '/api/': { target: `http://${SERVER_HOST}:${SERVER_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
