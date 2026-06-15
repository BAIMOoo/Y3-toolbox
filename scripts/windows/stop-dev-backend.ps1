<# Stop only the local development agent backend. #>
[CmdletBinding()]
param(
  [string]$ProjectRoot = ''
)

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$ErrorActionPreference = 'SilentlyContinue'
$pidFile = Join-Path $ProjectRoot '.omx\state\agent-runner-dev-win.pid'
if (Test-Path -LiteralPath $pidFile) {
  $pidValue = Get-Content -LiteralPath $pidFile -Raw
  if ($pidValue -match '\d+') { Stop-Process -Id ([int]$Matches[0]) -Force }
  Remove-Item -LiteralPath $pidFile -Force
}

Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8791 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

Get-CimInstance Win32_Process |
  Where-Object {
    ($_.CommandLine -like "*$ProjectRoot*" -and $_.CommandLine -match 'agent-runner-dev-windows\.log') -or
    ($_.CommandLine -like "*$ProjectRoot*" -and $_.CommandLine -match 'scripts/agent-runner/index\.ts' -and $_.CommandLine -match 'AGENT_RUNNER_PORT = ''8791''') -or
    ($_.CommandLine -like "*$ProjectRoot*" -and $_.CommandLine -match 'scripts/agent-runner/index\.ts' -and $_.CommandLine -match 'dev-agent-jobs')
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Output "stopped Windows dev agent backend for $ProjectRoot"
