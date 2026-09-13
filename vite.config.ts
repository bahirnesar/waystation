import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5555,
    open: false,
    cors: true
  },
  preview: {
    host: true,
    port: 5555
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three']
        }
      }
    }
  }
});
