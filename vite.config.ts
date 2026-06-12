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
export default defineConfig({
  base: './', // Electron 需要相对路径
  server: {
    host: '0.0.0.0',
  },
  plugins: [
    react(),
    electron([
      {
        // 主进程入口
        entry: 'electron/main.ts',
        onstart: startElectronOnce,
        vite: {
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
