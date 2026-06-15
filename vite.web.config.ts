import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const agentRunnerUrl = process.env.VITE_AGENT_RUNNER_URL || ''
const agentServiceProxyTarget = process.env.AGENT_SERVICE_PROXY_TARGET
  || process.env.AGENT_RUNNER_PROXY_TARGET
  || process.env.AGENT_RUNNER_URL
  || 'http://127.0.0.1:8790'

export default defineConfig({
  define: {
    __AGENT_RUNNER_URL__: JSON.stringify(agentRunnerUrl),
  },
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['y3toolbox.b4im.com'],
    proxy: {
      '/api': {
        target: agentServiceProxyTarget,
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
})
