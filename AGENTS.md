# Project Agent Notes

This public repository contains the Electron/local archive diff desktop app.

## Directory role

This directory is the **active development checkout**:

- Windows path: `C:\Users\BAIM\Desktop\Y3工具箱`
- WSL path: `/mnt/c/Users/BAIM/Desktop/Y3工具箱`

Use this directory for normal coding, tests, and local/dev backend work.

The public backend is now isolated in a separate runtime directory:

- Windows path: `C:\Users\BAIM\Desktop\Y3工具箱-public-runtime`
- WSL path: `/mnt/c/Users/BAIM/Desktop/Y3工具箱-public-runtime`
- Public URL: `https://y3toolbox.b4im.com`
- Cloudflare named tunnel: `y3-toolbox-public`

Do not assume the public service is running from this development checkout.

## Development

- Install dependencies with `npm ci`.
- Run local development with `npm run dev:electron`.
- Verify changes with `npx tsc -b --pretty false`, `npm run lint`, and `npm run test` when applicable.
- Keep public documentation focused on local CSV / Archive workflows and GitHub Releases downloads.

## Electron verification workflow

When verifying Electron main/preload changes from WSL, do not treat a `cmd.exe`, `npm.cmd`, or Vite wrapper PID as proof
that the desktop app loaded the latest code. Confirm a real Windows `electron.exe` process is running from this checkout
and that `package.json` points at the freshly built `dist-electron/main.js`.

For reliable manual verification after `npm run build`, launch the built app directly from Windows with the dev backend:

```powershell
cd "C:\Users\BAIM\Desktop\Y3工具箱"
$env:NODE_ENV = "production"
$env:AGENT_RUNNER_URL = "http://127.0.0.1:8791"
.\node_modules\electron\dist\electron.exe .
```

Then verify the loaded process, not just a wrapper:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -ieq "electron.exe" -and $_.CommandLine -like "*Y3工具箱*" } |
  Select-Object ProcessId,ParentProcessId,Name,CommandLine
```

If Windows `npm.cmd run dev:electron` fails with a missing Rolldown optional binding after dependencies were installed
from WSL, prefer the built-app launch above for verification instead of assuming a restart succeeded. Do not restart or
touch the public runtime while performing this local Electron verification.

## Backend development workflow

For backend development from this checkout, use the dev-only Windows backend scripts:

```powershell
cd "C:\Users\BAIM\Desktop\Y3工具箱"
.\scripts\windows\start-dev-backend.ps1
```

Dev backend defaults:

- Runner: `127.0.0.1:8791`
- Vite/proxy: `127.0.0.1:5174`
- Cloudflare: not started by default
- Dev jobs root: `.omx\dev-agent-jobs`
- Dev public input root: `.omx\dev-public-input`

Stop only the dev backend with:

```powershell
.\scripts\windows\stop-dev-backend.ps1
```

This dev stop script is expected to avoid public PID files and public Cloudflare processes.

## Public runtime isolation

The public backend currently runs from:

```text
C:\Users\BAIM\Desktop\Y3工具箱-public-runtime
```

Public backend defaults:

- Runner: `127.0.0.1:8790`
- Vite/proxy: `0.0.0.0:5173` in the current launcher
- Cloudflare named tunnel: `y3-toolbox-public`
- Public URL: `https://y3toolbox.b4im.com`
- Queue limits: max running `5`, max queued `10`

Do **not** stop, restart, or migrate the public runtime from this development checkout unless the user explicitly asks for public service maintenance.

The public runtime is executed by Windows PowerShell/Node processes. When installing or refreshing dependencies under
`C:\Users\BAIM\Desktop\Y3工具箱-public-runtime`, use Windows `npm.cmd ci` from PowerShell/cmd. Do **not** run WSL/Linux
`npm ci` in the public runtime directory: it creates Linux-style `node_modules/.bin` symlinks, causing Windows `npx.cmd`
startup commands such as `tsx` and `vite` to fail with "not recognized" errors and leaving the public runner/Vite ports
down.

To inspect both public and dev status without mutation:

```powershell
.\scripts\windows\status-backend.ps1
```

## Promotion to public runtime

Use `scripts/windows/sync-public-runtime.ps1` only as an explicit promotion/migration tool.

- Default mode is `DRY RUN`.
- `-Apply` is required to copy files.
- `-RestartPublic` requires `-Apply` and affects the public service.
- Public restart/migration should only happen with explicit user confirmation.

After changing backend/public-serving code, verify before promotion:

```powershell
npm.cmd run test
npx.cmd tsc -b --pretty false
npm.cmd run lint -- --quiet
```
