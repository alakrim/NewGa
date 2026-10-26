import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  build: { outDir: '../../dist/client', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
