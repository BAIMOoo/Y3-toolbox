/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_RUNNER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __AGENT_RUNNER_URL__: string
