# Project Agent Notes

This public repository contains only the Electron/local archive diff client.

## Repository Boundary

- Client checkout: `C:\Users\BAIM\Desktop\Y3工具箱`
- Client remote: `BAIMOoo/Y3-toolbox`
- Private backend checkout: `C:\Users\BAIM\Desktop\Y3-toolbox-backend-private`
- Private backend remote: `BAIMOoo/Y3-toolbox-backend-private`
- Public service URL: `https://y3toolbox.b4im.com`

Keep Agent Job Center UI, API callers, shared wire types, Electron integration, artifact download UX, and client compatibility presentation here.

Keep Runner processes, provider/model selection, server sanitization, private skills, queue/persistence logic, backend tests, proxy implementation, launch/status/sync scripts, and deployment documentation in the private backend repository.

Do not add backend implementation to this repository. Do not use the public runtime directory as a Git destination.

## Development

- Install dependencies with `npm ci`.
- Run local development with `npm run dev:electron`.
- Verify changes with `npx tsc -b --pretty false`, `npm run lint -- --quiet`, and `npm run test`.
- Run `npm run build` for production-build verification.
- Keep public documentation focused on local CSV/Archive workflows and GitHub Releases downloads.

The client may connect to the public service or to a separately started private-backend development instance. Starting, stopping, syncing, or deploying that backend is not a client-repository operation.

## Electron Verification

When verifying Electron main/preload changes from WSL, do not treat a `cmd.exe`, `npm.cmd`, or Vite wrapper PID as proof that the desktop app loaded the latest code. Confirm a real Windows `electron.exe` process is running from this checkout and that `package.json` points at the freshly built `dist-electron/main.js`.

After `npm run build`, launch the built app directly from Windows:

```powershell
cd "C:\Users\BAIM\Desktop\Y3工具箱"
$env:NODE_ENV = "production"
$env:AGENT_RUNNER_URL = "https://y3toolbox.b4im.com"
.\node_modules\electron\dist\electron.exe .
```

Then verify the loaded process:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -ieq "electron.exe" -and $_.CommandLine -like "*Y3工具箱*" } |
  Select-Object ProcessId,ParentProcessId,Name,CommandLine
```

If Windows `npm.cmd run dev:electron` fails with a missing optional binding after dependencies were installed from WSL, prefer the built-app launch above. Do not touch the public runtime while verifying the client.

## Backend Work

Use the project skill `.codex/skills/guard-public-backend-repo` whenever a task touches the public Agent service or may cross the repository boundary.

Perform backend edits, tests, and commits in `C:\Users\BAIM\Desktop\Y3-toolbox-backend-private`. Public runtime sync, restart, deployment, and online smoke tests require a separate explicit maintenance request.
