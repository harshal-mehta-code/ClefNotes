import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA. No server, no API keys, no backend — deployable to any static host.
// `base` is overridable so GitHub Pages project sites work: BASE=/ClefNotes/ npm run build
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          verovio: ['verovio/wasm', 'verovio/esm'],
          pdf: ['pdfjs-dist'],
        },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['verovio'] },
});
