import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    publicDir: './', // Serve static files like manifest.json from root
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  };
});