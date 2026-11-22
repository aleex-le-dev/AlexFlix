import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const apiPort = env.PORT || '4000';
  const vitrine = mode === 'vitrine';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __VITRINE__: JSON.stringify(vitrine)
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false }
      }
    },
    build: {
      outDir: vitrine ? 'dist-vitrine' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500
    }
  };
});
