import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function readPackageVersion() {
  try {
    const parsed = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const y3ToolboxVersion = readPackageVersion()
const agentRunnerUrl = process.env.VITE_AGENT_RUNNER_URL || ''
const agentServiceProxyTarget = process.env.AGENT_SERVICE_PROXY_TARGET
  || process.env.AGENT_RUNNER_PROXY_TARGET
  || process.env.AGENT_RUNNER_URL
  || 'http://127.0.0.1:8790'

export default defineConfig({
  define: {
    __AGENT_RUNNER_URL__: JSON.stringify(agentRunnerUrl),
    __Y3_TOOLBOX_VERSION__: JSON.stringify(y3ToolboxVersion),
  },
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['y3toolbox.b4im.com'],
    proxy: {
      '/api': {
        target: agentServiceProxyTarget,
        changeOrigin: true,
        bypass(req, res) {
          if (req.url?.startsWith('/api/diagnostics')) {
            res.statusCode = 404
            res.end('Not found')
            return false
          }
        },
      },
    },
  },
  plugins: [react()],
})
