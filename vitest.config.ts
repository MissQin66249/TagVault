import { defineConfig } from 'vitest/config';

// Vitest 配置：node 环境，测试直接以 TS 运行（无需预编译）。
export default defineConfig({
  cacheDir: 'node_modules/.tmp-vitest',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
