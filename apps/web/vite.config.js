import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Venue geometry shared with the API (apps/venue-core), so previews and booking match the server
      '@venue-core': fileURLToPath(new URL('../venue-core/src/index.js', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
