<#
.SYNOPSIS
  Start the local development agent backend only.

.DESCRIPTION
  Starts the Agent Job runner on 127.0.0.1:8791 using Windows Node, matching
  the public runtime process model. It does not start Vite, cloudflared, WSL,
  or any public runtime process.

  The development checkout is often installed from WSL, so this script keeps a
  tiny Windows-only tsx install under .omx\windows-node instead of modifying the
  main node_modules directory.
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
  [int]$RunnerPort = 8791,
  [int]$MaxConcurrentJobs = 5,
  [int]$MaxQueuedJobs = 10,
  [switch]$Mock,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Write-Utf8File([string]$Path, [string]$Value) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Ensure-WindowsTsx([string]$Root, [bool]$SkipInstall) {
  $toolRoot = Join-Path $Root '.omx\windows-node'
  $tsx = Join-Path $toolRoot 'node_modules\.bin\tsx.cmd'
  if ((Test-Path -LiteralPath $tsx) -or $SkipInstall) { return $tsx }

  New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
  $packageJson = Join-Path $toolRoot 'package.json'
  if (-not (Test-Path -LiteralPath $packageJson)) {
    Write-Utf8File $packageJson '{"private":true,"type":"module"}'
  }
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCommand) { $npm = $npmCommand.Source } else { $npm = (Get-Command npm -ErrorAction Stop).Source }
  & $npm install --prefix $toolRoot tsx@4.22.4 --no-audit --no-fund
  if (-not (Test-Path -LiteralPath $tsx)) { throw "Windows tsx install failed: $tsx" }
  return $tsx
}

function Resolve-Y3SourceRoot([string]$Root) {
  if (-not $Root) { return '' }
  if (Test-Path -LiteralPath (Join-Path $Root 'Server\server\engine\dm')) { return $Root }
  $srcRoot = Join-Path $Root 'src'
  if (Test-Path -LiteralPath (Join-Path $srcRoot 'Server\server\engine\dm')) { return $srcRoot }
  return $Root
}

function Start-LoggedProcess([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [hashtable]$Environment, [string]$LogPath) {
  $envPrefix = ''
  foreach ($key in $Environment.Keys) {
    $value = [string]$Environment[$key]
    $envPrefix += "`$env:$key = '$($value.Replace("'", "''"))'; "
  }
  $quotedArgs = ($ArgumentList | ForEach-Object { "'$($_.Replace("'", "''"))'" }) -join ' '
  $command = "Set-Location -LiteralPath '$($WorkingDirectory.Replace("'", "''"))'; $envPrefix & '$($FilePath.Replace("'", "''"))' $quotedArgs 2>&1 | Tee-Object -FilePath '$($LogPath.Replace("'", "''"))'"
  return Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', $command) -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
}

Set-Location -LiteralPath $ProjectRoot
$stateDir = Join-Path $ProjectRoot '.omx\state'
$logDir = Join-Path $ProjectRoot '.omx\logs'
New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null

Get-Command node -ErrorAction Stop | Out-Null
$tsx = Ensure-WindowsTsx -Root $ProjectRoot -SkipInstall ([bool]$SkipInstall)

$resolvedY3SourceRoot = Resolve-Y3SourceRoot -Root $MismatchSourceRoot
if (-not $KkresRuntimeRoot -and (Test-Path -LiteralPath $resolvedY3SourceRoot)) { $KkresRuntimeRoot = $resolvedY3SourceRoot }
if (-not $KkresRepoRoot -and $KkresRuntimeRoot) { $KkresRepoRoot = Join-Path $KkresRuntimeRoot 'Server\server\engine\dm' }
if (-not $KkresProjectPath -and $KkresRuntimeRoot) { $KkresProjectPath = Join-Path $KkresRuntimeRoot 'LocalData\ProjectName001' }
if (-not $KkresPublicInputRoot) { $KkresPublicInputRoot = Join-Path $ProjectRoot '.omx\dev-public-input' }
New-Item -ItemType Directory -Force -Path $KkresPublicInputRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $KkresPublicInputRoot 'staging') | Out-Null

& (Join-Path $PSScriptRoot 'stop-dev-backend.ps1') -ProjectRoot $ProjectRoot | Out-Null
Start-Sleep -Seconds 1

$jobsRoot = Join-Path $ProjectRoot '.omx\dev-agent-jobs'
$runnerEnv = @{
  AGENT_RUNNER_PORT = [string]$RunnerPort
  AGENT_RUNNER_HOST = '127.0.0.1'
  AGENT_RUNNER_JOBS_ROOT = $jobsRoot
  AGENT_RUNNER_PROJECT_ROOT = $ProjectRoot
  AGENT_RUNNER_MAX_CONCURRENT = [string]$MaxConcurrentJobs
  AGENT_RUNNER_MAX_QUEUED = [string]$MaxQueuedJobs
  AGENT_MISMATCH_SOURCE_ROOT = $MismatchSourceRoot
  Y3_SOURCE_ROOT = $MismatchSourceRoot
  AGENT_ARCHIVE_LOGTAIL_PATH = $ArchiveLogtailPath
  AGENT_KKRES_RUNTIME_ROOT = $KkresRuntimeRoot
  AGENT_KKRES_REPO_ROOT = $KkresRepoRoot
  AGENT_KKRES_PROJECT_PATH = $KkresProjectPath
  AGENT_KKRES_PUBLIC_INPUT_ROOT = $KkresPublicInputRoot
}
if ($Mock) {
  $runnerEnv.AGENT_RUNNER_MOCK = '1'
  $runnerEnv.AGENT_PROVIDER_NAME = 'mock-agent'
}

$logPath = Join-Path $logDir 'agent-runner-dev-windows.log'
$runner = Start-LoggedProcess -FilePath $tsx -ArgumentList @('scripts/agent-runner/index.ts') -WorkingDirectory $ProjectRoot -Environment $runnerEnv -LogPath $logPath
Write-Utf8File (Join-Path $stateDir 'agent-runner-dev-win.pid') ([string]$runner.Id)

$health = $null
$healthOk = $false
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline -and -not $healthOk) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$RunnerPort/api/health" -TimeoutSec 3
    $healthOk = $true
  } catch {}
}
if (-not $healthOk) {
  Write-Warning 'Dev runner validation failed: unable to reach local runner health endpoint'
}

$summary = [ordered]@{
  projectRoot = $ProjectRoot
  runnerPort = $RunnerPort
  runnerUrl = "http://127.0.0.1:$RunnerPort"
  runnerPid = $runner.Id
  runnerPidKind = 'windows'
  jobsRoot = $jobsRoot
  kkresPublicInputRoot = $KkresPublicInputRoot
  kkresProjectPath = $KkresProjectPath
  tsx = $tsx
  mock = [bool]$Mock
  healthReachable = $healthOk
  runnerReady = if ($health) { [bool]$health.ready } else { $false }
  health = $health
}
$summaryJson = $summary | ConvertTo-Json -Depth 20
Write-Utf8File (Join-Path $stateDir 'windows-dev-backend-status.json') $summaryJson
Write-Output $summaryJson
