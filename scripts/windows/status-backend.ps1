<# Report public and local development backend status without mutating processes. #>
[CmdletBinding()]
param(
  [string]$ProjectRoot = ''
)

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Test-HttpJson([string]$Uri) {
  try {
    return @{
      reachable = $true
      payload = Invoke-RestMethod -Uri $Uri -TimeoutSec 3
    }
  } catch {
    return @{
      reachable = $false
      error = $_.Exception.Message
    }
  }
}

function Read-Pid([string]$RelativePath) {
  $path = Join-Path $ProjectRoot $RelativePath
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $value = Get-Content -LiteralPath $path -Raw
  if ($value -match '\d+') { return [int]$Matches[0] }
  return $null
}

$status = [ordered]@{
  projectRoot = $ProjectRoot
  public = [ordered]@{
    runnerUrl = 'http://127.0.0.1:8790'
    viteUrl = 'http://127.0.0.1:5173'
    runnerPid = Read-Pid '.omx\state\agent-runner-win.pid'
    vitePid = Read-Pid '.omx\state\vite-dev-win.pid'
    cloudflaredPid = Read-Pid '.omx\state\cloudflared-web-win.pid'
    health = Test-HttpJson 'http://127.0.0.1:8790/api/health'
  }
  dev = [ordered]@{
    runnerUrl = 'http://127.0.0.1:8791'
    viteUrl = 'http://127.0.0.1:5174'
    runnerPid = Read-Pid '.omx\state\agent-runner-dev-win.pid'
    runnerPidKind = 'windows'
    health = Test-HttpJson 'http://127.0.0.1:8791/api/health'
  }
}

$status | ConvertTo-Json -Depth 20
