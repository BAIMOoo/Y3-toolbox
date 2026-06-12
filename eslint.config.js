import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'dist-electron-build', 'dist-electron-portable', 'release-portable', 'node_modules', '.omx', '.worktrees']),
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.{ts,tsx}', '*.ts', 'scripts/recovery/**/*.{ts,tsx}', 'scripts/recovery-tool.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
