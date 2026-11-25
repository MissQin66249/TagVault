import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：root 指向 client/，构建产物输出到项目根 dist/，
// dev 模式下 /api 代理到本地 Express（48765）。
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:48765',
        changeOrigin: true,
      },
    },
  },
});
