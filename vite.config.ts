import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

let hasStartedElectron = false

async function startElectronOnce({
  startup,
  reload,
}: {
  startup: () => void | Promise<void>
  reload: () => void
}) {
  if (hasStartedElectron) {
    reload()
    return
  }

  hasStartedElectron = true
  await startup()
}

// https://vite.dev/config/
const agentRunnerUrl = process.env.VITE_AGENT_RUNNER_URL || ''
const agentServiceProxyTarget = process.env.AGENT_SERVICE_PROXY_TARGET
  || process.env.AGENT_RUNNER_PROXY_TARGET
  || process.env.AGENT_RUNNER_URL
  || 'http://127.0.0.1:8790'

export default defineConfig({
  define: {
    __AGENT_RUNNER_URL__: JSON.stringify(agentRunnerUrl),
  },
  base: './', // Electron 需要相对路径
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: agentServiceProxyTarget,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    electron([
      {
        // 主进程入口
        entry: 'electron/main.ts',
        onstart: startElectronOnce,
        vite: {
          define: {
            __AGENT_RUNNER_URL__: JSON.stringify(agentRunnerUrl),
          },
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      {
        // 预加载脚本入口
        entry: 'electron/preload.ts',
        onstart: startElectronOnce,
        vite: {
          define: {
            __AGENT_RUNNER_URL__: JSON.stringify(agentRunnerUrl),
          },
          build: {
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                format: 'cjs',
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
})
