# 公开共享后端发布说明

本说明覆盖 `y3工具箱` 第一版公开共享后端。目标是让外部用户通过公开应用/页面访问同一个后端服务，并提交固定 allowlist 内的真实任务。

## 发布姿态

- 后端无账号、无邀请码、无审批 gate；任何可访问公开应用/页面的人都可能提交 allowlist 任务。
- 这不是生产级 SLA 服务；后端可能限流、排队、维护、禁提交或关闭。
- 公开不代表任意执行：客户端只能提交结构化参数，服务端只运行固定 allowlist 任务。
- 任务运行在维护者的共享 Windows/Y3 后端资源上；外部用户不需要也不应看到后端本机路径、命令、环境变量或完整诊断。

## 公开任务范围

首版公开三项任务：

1. `fetch-archive-changes` / 拉取存档日志
2. `fetch-mismatch-logs` / 拉取不同步日志
3. `export-kkres-image` / 导出 kkres 高分辨率图片

`export-kkres-image` 公开输入只接受上传/暂存后得到的图片标识，例如 `staging:xxx.png` 或 `public-input/xxx.png`。公开后端不接受任意 Windows 盘符、UNC、绝对路径、上级目录穿越或脚本式片段。

## 后端启动拓扑

公开 beta 后端服务默认仍作为 Windows 进程启动，公网入口固定为 Cloudflare named tunnel：

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File scripts/windows/start-public-beta-backend.ps1 \
  -ManifestPath release\release-manifest.json \
  -MismatchSourceRoot 'I:\map'
```

- Public Runner: `127.0.0.1:8790`
- Public Vite/proxy: binds `0.0.0.0:5173` in the current launcher so Cloudflare can reach the Windows process; keep firewall/LAN exposure assumptions in mind. Public users still use the Cloudflare origin, not the LAN address.
- Public tunnel: named tunnel `y3-toolbox-public`
- Public URL: `https://y3toolbox.b4im.com`
- Public web users must call the backend through the same public origin `/api`; do not publish `http://127.0.0.1:8790` to external users.
- The startup script enables `AGENT_RUNNER_TRUST_PROXY=1` for both Vite and runner so the runner throttles by Cloudflare client IP metadata that Vite accepts only from loopback cloudflared ingress, not from direct LAN/private peers.
- The startup script creates/configures `AGENT_KKRES_PUBLIC_INPUT_ROOT`; `staging:` identifiers resolve under its `staging/` child and `public-input/` identifiers resolve under the root.
- The runner capacity defaults are `AGENT_RUNNER_MAX_CONCURRENT=5` and `AGENT_RUNNER_MAX_QUEUED=10`.
- The public startup script requires explicit release metadata, either through `-ManifestPath release\release-manifest.json` or explicit release parameters. It must not infer public compatibility metadata from `package.json`.
- Public Vite/proxy must not forward `/api/diagnostics`; diagnostics remain local/protected even though `/api/health` and public task APIs are proxied.


## Release train 与客户端兼容策略

首版采用 **release train + 独立版本/兼容范围**：每次协调发布有一个 `releaseTrainId`，客户端和后端仍保留各自 semver 版本。后端通过 `/api/health.release` 暴露最小客户端版本和支持范围，客户端只用这份公开安全对象判断是否允许新提交。

`/api/health.release` 的公开字段固定为：

```ts
{
  schemaVersion: 1,
  releaseTrainId: string,
  clientVersion: string,
  backendVersion: string,
  backendCommit?: string,
  builtAt?: string,
  minimumClientVersion: string,
  supportedClientRange: string,
  latestClientUrl?: string,
  releaseNotesUrl?: string,
}
```

兼容规则：

- `minimumClientVersion` 是首版提交门禁的权威下限。
- `supportedClientRange` 首版接受 `>=x.y.z` 或 `x.y.z - a.b.c`，并且必须包含 `minimumClientVersion`。
- 客户端版本兼容时，Agent 任务中心行为保持原样。
- 客户端过旧、release 字段缺失、schema/version/range 异常时，Agent 任务中心进入只读/禁止提交状态：队列、已有任务和下载结果可以继续查看，新任务提交按钮禁用，并显示 GitHub Releases 下载入口。
- 维护状态 `queue.submissionsDisabled` 与兼容失败是两个不同状态；任一状态都不能启用提交。
- 本地 CSV / Archive 查看功能不依赖共享后端，不受兼容门禁影响。
- 首版不做静默强制更新、不后台替换 exe、不引入 NSIS/MSIX/Squirrel/electron-updater；用户按提示手动下载 Windows portable exe。

发布候选必须生成 manifest，不能手工维护。GitHub Release workflow 会运行 `scripts/release/generateReleaseManifest.ts`，生成并随 portable exe 一起上传/发布 `release/release-manifest.json`。manifest 记录 release train、client/backend 版本、兼容范围、commit、构建时间、候选下载链接、非本机路径的 public runtime 目标标识、验证命令和 promotion 状态；具体 Windows 目录只存在于 operator 本地 promotion 参数/脚本默认值中，不进入公开 release artifact。


## 本机继续开发后端的隔离工作流

当前推荐姿态是 **protected dev mode first, full isolation later**：在同一台 Windows 开发机上保留公网服务不动，用另一组端口和运行态目录启动开发后端。这样可以继续本地开发，同时避免 dev 启动脚本误停公网进程。

### 日常命令

查看 public/dev 状态（只读，不会启动/停止服务）：

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File scripts/windows/status-backend.ps1
```

启动开发后端：

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File scripts/windows/start-dev-backend.ps1 \
  -MismatchSourceRoot 'I:\map'
```

停止开发后端（只停 dev PID/端口特征，不停公网 tunnel）：

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File scripts/windows/stop-dev-backend.ps1
```

开发后端默认拓扑：

- Dev Runner: `127.0.0.1:8791`
- Dev Vite/proxy: `127.0.0.1:5174`
- Dev Cloudflare: 默认不启动；只有显式传 `-StartCloudflared` 才会开临时 quick tunnel。
- Dev jobs root: `.omx\dev-agent-jobs`
- Dev public-input root: `.omx\dev-public-input`
- Dev status file: `.omx\state\dev-backend-status.json`
- Dev PID files: `.omx\state\agent-runner-dev-win.pid`, `.omx\state\vite-dev-backend-win.pid`
- Dev logs: `.omx\logs\agent-runner-dev-windows.log`, `.omx\logs\vite-dev-backend-windows.log`

### Protected dev mode vs full isolation

Protected dev mode 已经做到：

- public 继续使用 `8790/5173` 和 `https://y3toolbox.b4im.com`；dev 使用 `8791/5174`。
- dev 启动不会调用 public 的 broad stop 逻辑，也不会读写 public PID 文件。
- dev 的 jobs/public-input/status/log/PID 路径与 public 分开，并做运行态根目录重叠检查。
- Cloudflare named tunnel 不会因为启动 dev 后端而改变。

Protected dev mode 仍不是完整隔离：如果 public 仍从当前开发 checkout 运行，修改源码可能影响下一次 public 重启后的代码版本。**完整隔离只有在 public runtime 迁移到独立目录并从该目录启动后才成立。**

### 手动 promotion / public runtime 迁移脚手架

`scripts/windows/sync-public-runtime.ps1` 是唯一 canonical promotion 入口。它默认只 dry-run，不复制、不停公网、不重启，并会写 `.omx\state\sync-public-runtime-status.json` 记录 `dry-run`、`synced`、`restarted`、`health-ok`、`health-failed`、`rollback-failed` 等终态。正常开发验证不得执行真实 public restart/cutover。

默认只 dry-run，不复制、不停公网、不重启：

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File scripts/windows/sync-public-runtime.ps1
```

默认目标目录为当前目录同级的 `Y3工具箱-public-runtime`。可显式指定：

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File scripts/windows/sync-public-runtime.ps1 \
  -TargetRoot 'C:\Users\BAIM\Desktop\Y3工具箱-public-runtime'
```

真正复制必须显式加 `-Apply`：

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File scripts/windows/sync-public-runtime.ps1 \
  -TargetRoot 'C:\Users\BAIM\Desktop\Y3工具箱-public-runtime' \
  -Apply
```

`-RestartPublic` 必须和 `-Apply` 一起使用，并且只应在维护者单独确认公网迁移/重启窗口后执行。不要把 `-RestartPublic` 放入日常开发命令或自动化脚本。

Rollback / maintenance 边界：

- `-Rollback` 也必须和 `-Apply` 一起使用；首版脚手架会记录 rollback 需求和失败终态，但没有 backup slot 时不会凭空回滚。
- `-EnableMaintenance` / `-DisableMaintenance` 只记录运维意图；实际维护模式仍由 runner 启动环境 `AGENT_RUNNER_MAINTENANCE=1` 或 `AGENT_RUNNER_DISABLE_SUBMISSIONS=1` 控制。
- restart 后脚本会尝试 `/api/health`、`/api/skills`、Vite proxy `/api/skills` 和 public URL health smoke；失败不能记录为成功终态。

同步脚手架默认排除运行态和临时目录，包括 `.omx\agent-jobs`、`.omx\dev-agent-jobs`、`.omx\public-input`、`.omx\dev-public-input`、`.omx\logs`、`.omx\state`、`.omx\tmp`、`node_modules`、构建输出、`release`/`release-portable`、私有后端目录和 `.git`。

## Guardrails

- Fixed skill allowlist only.
- Global running/queued limits.
- Per-source lightweight throttling includes a network-source cap independent of browser owner token, plus owner token + canonical network source + skill id as a secondary per-browser cap.
- Parameter size/range validation before job creation.
- Public event API hides raw stdout/stderr.
- Public summaries and errors redact local paths and environment-like values.
- Public artifacts are owner-scoped, path-confined, extension-filtered, and screened for unsafe names/content. ZIP downloads support only stored/deflated members and are intentionally bounded: archives over 10 MiB, unknown compression methods, or members requiring more than 1 MiB of text scan are withheld instead of partially exposed.
- `/api/diagnostics` is local-only/protected; public health is brief.
- `AGENT_RUNNER_DISABLE_SUBMISSIONS=1` or `AGENT_RUNNER_MAINTENANCE=1` disables new submissions.
- `fetch-mismatch-logs` readiness requires the Y3 `Package\Script\Python` link to resolve to the configured source root's `Server\server\engine`; stale links are treated as not ready.

## Verification

Before claiming public readiness, collect evidence for:

```bash
npx tsc -b --pretty false
npm run lint
npm run test
```

Release train evidence should also include the generated `release/release-manifest.json` and a dry-run status from `scripts/windows/sync-public-runtime.ps1` against the intended public runtime target. Do not include secrets, local private paths, or full diagnostics in public release notes.

In this WSL + Windows node_modules environment, Vitest may need to run through Windows Node if the Linux Rolldown optional binding is unavailable:

```bash
/init /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -Command 'Set-Location -LiteralPath "C:\Users\BAIM\Desktop\Y3工具箱"; npm.cmd run test'
```

Public stack smoke checks (local loopback checks still work even though the public Vite process binds `0.0.0.0`):

```bash
curl -fsS http://127.0.0.1:8790/api/skills >/dev/null && echo runner-8790-ok
curl -fsS http://127.0.0.1:5173/api/skills >/dev/null && echo vite-proxy-ok
URL=$(python3 - <<'PY'
from pathlib import Path
print(Path('.omx/state/cloudflared-web.url').read_text(encoding='utf-8-sig').strip())
PY
)
curl -fsS "$URL/api/skills" >/dev/null && echo public-skills-ok
```

## Emergency stop

1. Stop the Cloudflare tunnel / public backend stack.
2. Set maintenance/disable-submission mode for the runner.
3. Keep existing job outputs local for operator debugging.
4. Rotate the public tunnel URL before resuming if the link was leaked or abused.
