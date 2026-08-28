/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_RUNNER_URL?: string
  readonly VITE_TECHNICAL_QA_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __AGENT_RUNNER_URL__: string

declare const __Y3_TOOLBOX_VERSION__: string

declare const __TECHNICAL_QA_ENABLED__: boolean
