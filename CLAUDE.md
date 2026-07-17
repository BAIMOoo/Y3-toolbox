# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 规则

**始终使用中文回复用户。** 代码、技术术语和引用文件路径可以使用英文，但所有面向用户的说明、解释和对话必须使用中文。

## Project

Y3 工具箱 is an Electron desktop client for Y3 game archive analysis and public Agent tasks. Import archive-diff CSVs or local Archive JSON, browse timelines, inspect snapshot diffs, and submit jobs through the public service API.

- **Tech stack**: Electron 28, React 19, Ant Design 6, Vite 8, TypeScript 5.9
- **OS**: Windows development via WSL shell; the built Electron app runs as a native Windows process
- **Agent service**: `https://y3toolbox.b4im.com`
- **Backend repository**: `C:\Users\BAIM\Desktop\Y3-toolbox-backend-private` / `BAIMOoo/Y3-toolbox-backend-private`

For the client/backend ownership boundary and Electron verification workflow, see `AGENTS.md`.

## Commands

```bash
npm ci                   # Install dependencies
npm run dev              # Vite dev server (renderer only)
npm run dev:electron     # Vite + Electron dev mode (full app)
npm run build            # tsc type-check + vite build
npm run build:electron   # Build + package Electron app
npm run pack:win         # Windows portable package only
npm run lint             # ESLint
npm run test             # Vitest (single worker, node environment)
npm run test:watch       # Vitest in watch mode
npm run preview          # Vite preview of production build
npm run recovery         # Run recovery-tool.ts
```

Tests are configured in `vitest.config.js`: pool `forks` with `maxWorkers: 1` (required for WSL/Windows worktree stability). Include patterns cover `src/**/*.test.{js,ts}`, `scripts/**/*.test.{js,ts}`, and root `*.test.{js,ts}`.

TypeScript uses project references (`tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json` + `tsconfig.scripts.json`).

## Architecture

### Data flow (Archive Diff mode)

```
CSV/raw log file
  → src/parser/csvParser.ts        (parse CSV rows, handle raw/clean formats)
  → src/parser/archiveDiffParser.ts (extract & parse `archive_diff` strings into ArchiveChange[])
  → src/parser/pipeline.ts          (group changes by timestamp → TimePoint[])
  → src/hooks/useArchiveData.ts    (orchestrate parsing, filtering, snapshot engine, CSV download)
  → src/engine/snapshotEngine.ts    (lazy snapshot computation: apply diffs sequentially, cache last)
  → src/components/*.tsx           (Timeline, ChangeList, SnapshotView, ResizableSplit, StatusBar)
```

Key detail: `csvParser.ts` always outputs clean diff strings in `rawText`. `pipeline.ts`'s `buildTimePoints` checks `isClean` to decide whether to re-extract, maintaining backward compatibility with raw syslog lines.

### SnapshotEngine

Located at `src/engine/snapshotEngine.ts`. Lazily computes snapshots on demand rather than precomputing all of them. Maintains a single cached snapshot at `cachedIndex`. Sequential navigation (prev/next) is fast because it only applies changes forward from the cache.

### Three app modes

`src/App.tsx` switches between three modes via `AppMode`:
1. **`diff`** — Archive Diff workbench: CSV import → timeline + change list + snapshot comparison
2. **`local-archive`** — `LocalArchiveViewer`: browse local Y3 project Archive JSON (players, slots, tree view) with a Lua-like table parser
3. **`agent-jobs`** — `AgentJobCenter`: submit/queue/monitor backend agent tasks (fetch archive changes, mismatch logs, export kkres images)

### Electron IPC

- `electron/main.ts` — Main process: window management (frameless, custom controls), IPC handlers for file dialogs, file reading, archive input validation, agent service proxy (CORS bypass for `file://`), artifact downloads (origin-locked to configured runner URL), kkres image staging/upload
- `electron/preload.ts` — `contextBridge.exposeInMainWorld('electronAPI', {...})` with strictly scoped IPC channels
- `electron/agentArtifactDownload.ts` — Validates download URLs are same-origin as the configured runner and target `/api/jobs/:id/artifacts/:file` paths

The renderer accesses Electron APIs via `window.electronAPI` (typed in `src/types/electron.d.ts`). When `window.electronAPI` is absent (browser mode), CSV import falls back to the browser file uploader.

### Vite config

`vite.config.ts` uses `vite-plugin-electron` for the main process and preload, plus `vite-plugin-electron-renderer` for Node.js polyfills in the renderer. The dev proxy forwards `/api` requests to the agent runner (default `http://127.0.0.1:8791` dev, `http://127.0.0.1:8790` production). `__AGENT_RUNNER_URL__` is defined at build time via `define`.

### Agent service boundary

This repository owns the Agent Job Center UI, API callers, shared wire types, Electron proxy/download integration, and client compatibility presentation. Executable Runner code, provider/model selection, private skills, sanitization, queue/persistence logic, proxy implementation, backend tests, operations, and deployment documentation live in the private backend repository.

### State management

No external state library. `useArchiveData` hook (`src/hooks/useArchiveData.ts`) holds all diff state (timePoints, filter, selectedIndex, snapshotEngine). Filtering uses `src/utils/filterSnapshot.ts` (filter snapshot tree by rootKeys) and `src/engine/filterDiffLines.ts`.

### Theme system

Two UI tones — `graphite` (dark) and `paper` (light) — implemented via Ant Design `ConfigProvider` theme tokens in `src/App.tsx`. Preference persisted to `localStorage`. CSS variables in `src/App.css` for non-Ant Design elements.

## Testing conventions

- Test files co-located in `__tests__/` directories next to source
- Vitest with `environment: 'node'` (not jsdom by default)
- Contract tests (e.g., `diffViewStatusColorContract.test.ts`, `snapshotCompareToneContract.test.ts`) verify visual/behavioral contracts
- Electron-specific tests (e.g., `electron-mainline-smoke.test.ts`, `electron/startupOpenPath.test.ts`) test main-process logic in node environment
- Tests that need browser APIs use jsdom via `// @vitest-environment jsdom` directive

## Project Codex Skills (`.codex/`)

- `guard-public-backend-repo` enforces the client/private-backend ownership boundary.
- Client-owned project skills may remain here when they do not execute or operate the public service.
- Server-owned skills belong in the private backend repository and must not be copied into this client checkout.

## Key files

- `src/App.tsx` — Root component: mode switching, theme, error boundary, drag-drop routing, keyboard shortcuts
- `src/hooks/useArchiveData.ts` — Central state hook for the diff workbench
- `src/parser/csvParser.ts` — CSV parsing with raw/clean format auto-detection (500MB limit in `src/constants/fileLimits.ts`)
- `src/archiveViewer/archiveModel.ts` — Archive data model: normalization, player/slot extraction, Lua-like table parser
- `electron/main.ts` — All IPC handlers and Electron lifecycle
- `src/agentJobs/api.ts` — Public Agent service API client
- `scripts/recovery-tool.ts` — CLI tool for log recovery/extraction (runnable via `npm run recovery`)
