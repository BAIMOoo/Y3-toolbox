// vitest.config.js — 独立测试配置，不使用 vite-plugin-electron-renderer
// 确保 Node.js 内置模块（child_process、fs 等）可在测试中正常使用
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,ts}', 'scripts/agent-runner/**/*.test.{js,ts}', 'scripts/recovery/**/*.test.{js,ts}', 'scripts/windows/**/*.test.{js,ts}', '*.test.{js,ts}'],
    exclude: ['node_modules/**', '.worktrees/**', '.omx/**'],
    // Use a single forks worker to avoid worker startup timeouts in WSL/Windows worktrees.
    pool: 'forks',
    maxWorkers: 1,
  },
});
