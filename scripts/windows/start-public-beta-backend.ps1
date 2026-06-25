<#
.SYNOPSIS
  Start all public beta backend services as Windows processes.

.DESCRIPTION
  Starts, from the interactive Windows user session:
    - Agent runner on 127.0.0.1:8790
    - Vite web server on 0.0.0.0:5173, proxying /api to the runner
    - cloudflared named tunnel to http://127.0.0.1:5173

  This script intentionally keeps backend services in Windows instead of WSL so
  Windows-only resources such as mapped drives (for example I:\map) can be used
  by the runner when they are visible to the same Windows user session.
#>
[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [string]$MismatchSourceRoot = 'I:\map',
  [string]$ArchiveLogtailPath = 'D:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe',
  [string]$KkresRuntimeRoot = '',
  [string]$KkresRepoRoot = '',
  [string]$KkresProjectPath = '',
  [string]$KkresPublicInputRoot = '',
  [string]$CloudflareTunnelName = 'y3-toolbox-public',
  [string]$PublicUrl = 'https://y3toolbox.b4im.com',
  [int]$RunnerPort = 8790,
  [int]$VitePort = 5173,
  [int]$MaxConcurrentJobs = 5,
  [int]$MaxQueuedJobs = 10,
  [string]$ReleaseTrainId = '',
  [string]$LatestClientVersion = '',
  [string]$BackendVersion = '',
  [string]$MinimumClientVersion = '',
  [string]$SupportedClientRange = '',
  [string]$LatestClientUrl = 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
  [string]$ReleaseNotesUrl = 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
  [string]$ManifestPath = '',
  [switch]$UseQuickTunnel,
  [switch]$SkipCloudflared,
  [switch]$ShowChildWindows
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}


function Read-ReleaseManifest([string]$Path) {
  if (-not $Path) { return $null }
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Use-ManifestReleaseMetadata([object]$Manifest) {
  if (-not $Manifest) { return }
  if (-not $ReleaseTrainId -and $Manifest.releaseTrainId) { Set-Variable -Name ReleaseTrainId -Scope Script -Value ([string]$Manifest.releaseTrainId) }
  if (-not $LatestClientVersion -and $Manifest.clientVersion) { Set-Variable -Name LatestClientVersion -Scope Script -Value ([string]$Manifest.clientVersion) }
  if (-not $BackendVersion -and $Manifest.backendVersion) { Set-Variable -Name BackendVersion -Scope Script -Value ([string]$Manifest.backendVersion) }
  if (-not $MinimumClientVersion -and $Manifest.minimumClientVersion) { Set-Variable -Name MinimumClientVersion -Scope Script -Value ([string]$Manifest.minimumClientVersion) }
  if (-not $SupportedClientRange -and $Manifest.supportedClientRange) { Set-Variable -Name SupportedClientRange -Scope Script -Value ([string]$Manifest.supportedClientRange) }
  if ($Manifest.latestClientUrl) { Set-Variable -Name LatestClientUrl -Scope Script -Value ([string]$Manifest.latestClientUrl) }
  if ($Manifest.releaseNotesUrl) { Set-Variable -Name ReleaseNotesUrl -Scope Script -Value ([string]$Manifest.releaseNotesUrl) }
}

function Require-PublicReleaseMetadata() {
  foreach ($field in @('ReleaseTrainId', 'LatestClientVersion', 'BackendVersion', 'MinimumClientVersion', 'SupportedClientRange', 'LatestClientUrl', 'ReleaseNotesUrl')) {
    $value = Get-Variable -Name $field -ValueOnly
    if (-not [string]$value) { throw "Public release metadata is required before startup: $field" }
  }
}

function Write-Utf8File([string]$Path, [string]$Value) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Stop-ExistingBetaProcesses([string]$Root) {
  Get-CimInstance Win32_Process |
    Where-Object {
      ($_.CommandLine -like "*$Root*" -or $_.CommandLine -match 'scripts/agent-runner/index\.ts|vite\.web\.config\.ts|cloudflared.*(127\.0\.0\.1:5173|y3-toolbox-public)') -and
      ($_.CommandLine -match 'scripts/agent-runner/index\.ts|vite\.web\.config\.ts|cloudflared.*(127\.0\.0\.1:5173|y3-toolbox-public)')
    } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Get-CloudflaredPath([string]$Root) {
  $local = Join-Path $Root '.local-tools\bin\cloudflared.exe'
  if (Test-Path -LiteralPath $local) { return $local }
  $cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $local
}

function Ensure-Cloudflared([string]$CloudflaredPath) {
  if (Test-Path -LiteralPath $CloudflaredPath) { return }
  $dir = Split-Path -Parent $CloudflaredPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Write-Host "Downloading cloudflared for Windows: $url"
  Invoke-WebRequest -Uri $url -OutFile $CloudflaredPath -UseBasicParsing
}

function Ensure-Y3ScriptPythonLink([string]$SourceRoot) {
  if (-not $SourceRoot) { return }
  $linkPath = Join-Path $SourceRoot 'Package\Script\Python'
  $enginePath = Join-Path $SourceRoot 'Server\server\engine'
  if ((Test-Path -LiteralPath $linkPath) -and (Test-Path -LiteralPath (Join-Path $linkPath 'MPythonMain.py'))) { return }
  if (-not (Test-Path -LiteralPath $enginePath)) { return }
  $scriptLink = Join-Path $SourceRoot 'bat\Script_Link.bat'
  if (Test-Path -LiteralPath $scriptLink) {
    Push-Location -LiteralPath (Split-Path -Parent $scriptLink)
    try { & cmd.exe /c "`"$scriptLink`" `"$SourceRoot`"" | Out-Null } finally { Pop-Location }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $linkPath) | Out-Null
    if (Test-Path -LiteralPath $linkPath) { Remove-Item -LiteralPath $linkPath -Recurse -Force }
    & cmd.exe /c "mklink /D /J `"$linkPath`" `"$enginePath`"" | Out-Null
  }
}

function Resolve-Y3SourceRoot([string]$Root) {
  if (-not $Root) { return '' }
  if (Test-Path -LiteralPath (Join-Path $Root 'Server\server\engine\dm\commons\helper\digest_helper.py')) { return $Root }
  $srcRoot = Join-Path $Root 'src'
  if (Test-Path -LiteralPath (Join-Path $srcRoot 'Server\server\engine\dm\commons\helper\digest_helper.py')) { return $srcRoot }
  if (Test-Path -LiteralPath (Join-Path $Root 'Engine\Binaries\Win64\Game_x64h.exe')) { return $Root }
  if (Test-Path -LiteralPath (Join-Path $srcRoot 'Engine\Binaries\Win64\Game_x64h.exe')) { return $srcRoot }
  return $Root
}

function Start-LoggedProcess([string]$Name, [string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [hashtable]$Environment, [string]$LogPath, [bool]$Hidden = $true) {
  $envPrefix = ''
  foreach ($key in $Environment.Keys) {
    $value = [string]$Environment[$key]
    $envPrefix += "`$env:$key = '$($value.Replace("'", "''"))'; "
  }
  $quotedArgs = ($ArgumentList | ForEach-Object { "'$($_.Replace("'", "''"))'" }) -join ' '
  $command = "Set-Location -LiteralPath '$($WorkingDirectory.Replace("'", "''"))'; $envPrefix & '$($FilePath.Replace("'", "''"))' $quotedArgs 2>&1 | Tee-Object -FilePath '$($LogPath.Replace("'", "''"))'"
  $windowStyle = if ($Hidden) { 'Hidden' } else { 'Minimized' }
  $childArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass')
  if ($Hidden) { $childArgs += @('-WindowStyle', 'Hidden') }
  $childArgs += @('-Command', $command)
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $childArgs -WorkingDirectory $WorkingDirectory -WindowStyle $windowStyle -PassThru
  return $process
}

Set-Location -LiteralPath $ProjectRoot
$stateDir = Join-Path $ProjectRoot '.omx\state'
$logDir = Join-Path $ProjectRoot '.omx\logs'
New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null

Get-Command node -ErrorAction Stop | Out-Null
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) { $npm = $npmCommand.Source } else { $npm = (Get-Command npm -ErrorAction Stop).Source }
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if ($npxCommand) { $npx = $npxCommand.Source } else { $npx = (Get-Command npx -ErrorAction Stop).Source }

$sourceExists = Test-Path -LiteralPath $MismatchSourceRoot
$resolvedY3SourceRoot = Resolve-Y3SourceRoot -Root $MismatchSourceRoot
$digestCandidates = @(
  (Join-Path $MismatchSourceRoot 'Server\server\engine\dm\commons\helper\digest_helper.py'),
  (Join-Path $MismatchSourceRoot 'src\Server\server\engine\dm\commons\helper\digest_helper.py')
)
$digestCandidate = $digestCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($digestCandidate) {
  Ensure-Y3ScriptPythonLink -SourceRoot $resolvedY3SourceRoot
}
if (-not $KkresRuntimeRoot) { $KkresRuntimeRoot = $resolvedY3SourceRoot }
if (-not $KkresRepoRoot -and $KkresRuntimeRoot) { $KkresRepoRoot = Join-Path $KkresRuntimeRoot 'Server\server\engine\dm' }
if (-not $KkresProjectPath -and $KkresRuntimeRoot) { $KkresProjectPath = Join-Path $KkresRuntimeRoot 'LocalData\ProjectName001' }
if (-not $KkresPublicInputRoot) { $KkresPublicInputRoot = Join-Path $ProjectRoot '.omx\public-input' }
New-Item -ItemType Directory -Force -Path $KkresPublicInputRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $KkresPublicInputRoot 'staging') | Out-Null

if (-not $ManifestPath) { $ManifestPath = Join-Path $ProjectRoot 'release\release-manifest.json' }
Use-ManifestReleaseMetadata (Read-ReleaseManifest $ManifestPath)
Require-PublicReleaseMetadata
$BackendBuiltAt = (Get-Date).ToUniversalTime().ToString('o')

Stop-ExistingBetaProcesses -Root $ProjectRoot
Start-Sleep -Seconds 2

$runnerEnv = @{
  AGENT_RUNNER_PORT = [string]$RunnerPort
  AGENT_RUNNER_HOST = '127.0.0.1'
  AGENT_RUNNER_TRUST_PROXY = '1'
  AGENT_RUNNER_MAX_CONCURRENT = [string]$MaxConcurrentJobs
  AGENT_RUNNER_MAX_QUEUED = [string]$MaxQueuedJobs
  AGENT_MISMATCH_SOURCE_ROOT = $MismatchSourceRoot
  Y3_SOURCE_ROOT = $MismatchSourceRoot
  AGENT_ARCHIVE_LOGTAIL_PATH = $ArchiveLogtailPath
  AGENT_KKRES_RUNTIME_ROOT = $KkresRuntimeRoot
  AGENT_KKRES_REPO_ROOT = $KkresRepoRoot
  AGENT_KKRES_PROJECT_PATH = $KkresProjectPath
  AGENT_KKRES_PUBLIC_INPUT_ROOT = $KkresPublicInputRoot
  AGENT_RELEASE_TRAIN_ID = $ReleaseTrainId
  AGENT_LATEST_CLIENT_VERSION = $LatestClientVersion
  AGENT_BACKEND_VERSION = $BackendVersion
  AGENT_MINIMUM_CLIENT_VERSION = $MinimumClientVersion
  AGENT_SUPPORTED_CLIENT_RANGE = $SupportedClientRange
  AGENT_LATEST_CLIENT_URL = $LatestClientUrl
  AGENT_RELEASE_NOTES_URL = $ReleaseNotesUrl
  AGENT_BACKEND_BUILT_AT = $BackendBuiltAt
}
$runner = Start-LoggedProcess -Name 'agent-runner' -FilePath $npx -ArgumentList @('tsx', 'scripts/agent-runner/index.ts') -WorkingDirectory $ProjectRoot -Environment $runnerEnv -LogPath (Join-Path $logDir 'agent-runner-windows.log') -Hidden:(-not $ShowChildWindows)
Write-Utf8File (Join-Path $stateDir 'agent-runner-win.pid') ([string]$runner.Id)

$viteEnv = @{ AGENT_RUNNER_PROXY_TARGET = "http://127.0.0.1:$RunnerPort"; AGENT_RUNNER_TRUST_PROXY = '1' }
$vite = Start-LoggedProcess -Name 'vite-web' -FilePath $npx -ArgumentList @('vite', '--config', 'vite.web.config.ts', '--host', '0.0.0.0', '--port', [string]$VitePort) -WorkingDirectory $ProjectRoot -Environment $viteEnv -LogPath (Join-Path $logDir 'vite-web-windows.log') -Hidden:(-not $ShowChildWindows)
Write-Utf8File (Join-Path $stateDir 'vite-dev-win.pid') ([string]$vite.Id)

$cloudflared = $null
if (-not $SkipCloudflared) {
  $cloudflaredPath = Get-CloudflaredPath -Root $ProjectRoot
  Ensure-Cloudflared -CloudflaredPath $cloudflaredPath
  if ($UseQuickTunnel -or -not $CloudflareTunnelName) {
    $cloudflaredArgs = @('tunnel', '--url', "http://127.0.0.1:$VitePort")
  } else {
    $cloudflaredArgs = @('tunnel', 'run', '--url', "http://127.0.0.1:$VitePort", $CloudflareTunnelName)
  }
  $cloudflared = Start-LoggedProcess -Name 'cloudflared' -FilePath $cloudflaredPath -ArgumentList $cloudflaredArgs -WorkingDirectory $ProjectRoot -Environment @{} -LogPath (Join-Path $logDir 'cloudflared-windows.log') -Hidden:(-not $ShowChildWindows)
  Write-Utf8File (Join-Path $stateDir 'cloudflared-web-win.pid') ([string]$cloudflared.Id)
}

Start-Sleep -Seconds 8

$health = $null
$skillsOk = $false
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:$RunnerPort/api/skills" -UseBasicParsing -TimeoutSec 5 | Out-Null
  $skillsOk = $true
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$RunnerPort/api/diagnostics" -TimeoutSec 10
} catch {
  Write-Warning "Runner validation failed: $($_.Exception.Message)"
}

$tunnelUrl = $null
if (-not $SkipCloudflared) {
  if ($UseQuickTunnel -or -not $CloudflareTunnelName) {
    $deadline = (Get-Date).AddSeconds(45)
    $cloudLog = Join-Path $logDir 'cloudflared-windows.log'
    while ((Get-Date) -lt $deadline -and -not $tunnelUrl) {
      if (Test-Path -LiteralPath $cloudLog) {
        $content = Get-Content -LiteralPath $cloudLog -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[-a-zA-Z0-9]+\.trycloudflare\.com') { $tunnelUrl = $Matches[0] }
      }
      if (-not $tunnelUrl) { Start-Sleep -Seconds 2 }
    }
  } else {
    $tunnelUrl = $PublicUrl
  }
  if ($tunnelUrl) {
    Write-Utf8File (Join-Path $stateDir 'cloudflared-web.url') $tunnelUrl
  }
}

$summary = [ordered]@{
  projectRoot = $ProjectRoot
  runnerPort = $RunnerPort
  vitePort = $VitePort
  mismatchSourceRoot = $MismatchSourceRoot
  mismatchSourceRootExists = $sourceExists
  digestHelperFound = [bool]$digestCandidate
  digestHelperPath = $digestCandidate
  archiveLogtailPath = $ArchiveLogtailPath
  archiveLogtailExists = if ($ArchiveLogtailPath) { Test-Path -LiteralPath $ArchiveLogtailPath } else { $false }
  kkresRuntimeRoot = $KkresRuntimeRoot
  kkresProjectPath = $KkresProjectPath
  kkresProjectPathExists = if ($KkresProjectPath) { Test-Path -LiteralPath $KkresProjectPath } else { $false }
  kkresRuntimeRootExists = if ($KkresRuntimeRoot) { Test-Path -LiteralPath $KkresRuntimeRoot } else { $false }
  kkresRepoRoot = $KkresRepoRoot
  kkresRepoRootExists = if ($KkresRepoRoot) { Test-Path -LiteralPath $KkresRepoRoot } else { $false }
  kkresPublicInputRoot = $KkresPublicInputRoot
  kkresPublicInputRootExists = if ($KkresPublicInputRoot) { Test-Path -LiteralPath $KkresPublicInputRoot } else { $false }
  trustProxy = $true
  maxConcurrentJobs = $MaxConcurrentJobs
  maxQueuedJobs = $MaxQueuedJobs
  releaseTrainId = $ReleaseTrainId
  manifestPath = $ManifestPath
  latestClientVersion = $LatestClientVersion
  backendVersion = $BackendVersion
  minimumClientVersion = $MinimumClientVersion
  supportedClientRange = $SupportedClientRange
  cloudflareTunnelName = if ($SkipCloudflared -or $UseQuickTunnel) { $null } else { $CloudflareTunnelName }
  runnerPid = $runner.Id
  vitePid = $vite.Id
  cloudflaredPid = if ($cloudflared) { $cloudflared.Id } else { $null }
  tunnelUrl = $tunnelUrl
  runnerSkillsReachable = $skillsOk
  runnerReady = if ($health) { [bool]$health.ready } else { $false }
  diagnostics = $health
}
$summaryJson = $summary | ConvertTo-Json -Depth 20
Write-Utf8File (Join-Path $stateDir 'windows-backend-status.json') $summaryJson
Write-Output $summaryJson
