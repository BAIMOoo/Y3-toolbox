// vitest.config.js — 独立测试配置，不使用 vite-plugin-electron-renderer
// 确保 Node.js 内置模块（child_process、fs 等）可在测试中正常使用
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __Y3_TOOLBOX_VERSION__: JSON.stringify('0.1.6'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,ts}', 'scripts/recovery/**/*.test.{js,ts}', 'scripts/release/**/*.test.{js,ts}', '*.test.{js,ts}'],
    exclude: ['node_modules/**', '.worktrees/**', '.omx/**', '**/.omx/**', '**/scratch/**'],
    // Use a single vmThreads worker to avoid fork/worker startup timeouts in WSL/Windows worktrees.
    pool: 'vmThreads',
    maxWorkers: 1,
  },
});
