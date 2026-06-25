<#
  Sync this development checkout into the isolated public runtime directory.
  Default mode is dry-run: no files are copied and no public process is restarted.
#>
[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [string]$TargetRoot = '',
  [string]$ManifestPath = '',
  [string]$StatusPath = '',
  [switch]$Apply,
  [switch]$RestartPublic,
  [switch]$Rollback,
  [switch]$EnableMaintenance,
  [switch]$DisableMaintenance
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $ProjectRoot = (Resolve-Path $ProjectRoot).Path
}
if (-not $TargetRoot) {
  $TargetRoot = Join-Path (Split-Path -Parent $ProjectRoot) 'Y3工具箱-public-runtime'
}
if (-not $ManifestPath) {
  $ManifestPath = Join-Path $ProjectRoot 'release\release-manifest.json'
}
if (-not $StatusPath) {
  $StatusPath = Join-Path $ProjectRoot '.omx\state\sync-public-runtime-status.json'
}

$ExcludedRelativeRoots = @(
  '.git',
  '.local-tools',
  'node_modules',
  'dist',
  'dist-electron',
  'dist-electron-build',
  'dist-electron-portable',
  'release',
  'release-portable',
  'tmp',
  'logs',
  'Y3-toolbox-backend-private',
  '.omx\agent-jobs',
  '.omx\dev-agent-jobs',
  '.omx\public-input',
  '.omx\dev-public-input',
  '.omx\logs',
  '.omx\state',
  '.omx\tmp'
)

function Convert-ToFullPath([string]$PathValue) {
  $full = [System.IO.Path]::GetFullPath($PathValue)
  return $full.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Test-IsSubPath([string]$Candidate, [string]$Root) {
  $candidateFull = Convert-ToFullPath $Candidate
  $rootFull = Convert-ToFullPath $Root
  return $candidateFull.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-IsExcludedRelativePath([string]$RelativePath) {
  $normalized = $RelativePath -replace '/', '\'
  foreach ($excluded in $ExcludedRelativeRoots) {
    if ($normalized.Equals($excluded, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($normalized.StartsWith($excluded + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Read-ReleaseManifest([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue)) { return $null }
  return Get-Content -LiteralPath $PathValue -Raw | ConvertFrom-Json
}

function Require-ReleaseManifest([object]$Manifest, [string]$PathValue) {
  if (-not $Manifest) { throw "Release manifest is required for -Apply/-RestartPublic: $PathValue" }
  foreach ($field in @('releaseTrainId', 'clientVersion', 'backendVersion', 'minimumClientVersion', 'supportedClientRange', 'latestClientUrl', 'releaseNotesUrl')) {
    if (-not [string]$Manifest.$field) { throw "Release manifest missing required field: $field" }
  }
  Assert-Semver ([string]$Manifest.clientVersion) 'release manifest clientVersion'
  Assert-Semver ([string]$Manifest.backendVersion) 'release manifest backendVersion'
  Assert-Semver ([string]$Manifest.minimumClientVersion) 'release manifest minimumClientVersion'
  Assert-SupportedClientRange ([string]$Manifest.supportedClientRange) ([string]$Manifest.minimumClientVersion)
  Assert-PublicHttpsUrl ([string]$Manifest.latestClientUrl) 'release manifest latestClientUrl'
  Assert-PublicHttpsUrl ([string]$Manifest.releaseNotesUrl) 'release manifest releaseNotesUrl'
}

function Assert-Semver([string]$Value, [string]$FieldName) {
  if ($Value -notmatch '^\d+\.\d+\.\d+$') {
    throw "$FieldName must be semver-like x.y.z"
  }
}

function Convert-VersionTriple([string]$Value) {
  $match = [regex]::Match($Value, '^(\d+)\.(\d+)\.(\d+)$')
  if (-not $match.Success) { return $null }
  return @([int]$match.Groups[1].Value, [int]$match.Groups[2].Value, [int]$match.Groups[3].Value)
}

function Compare-VersionTriple([array]$Left, [array]$Right) {
  for ($i = 0; $i -lt 3; $i++) {
    if ($Left[$i] -ne $Right[$i]) { return ($Left[$i] - $Right[$i]) }
  }
  return 0
}

function Assert-SupportedClientRange([string]$Range, [string]$MinimumClientVersion) {
  $minimum = Convert-VersionTriple $MinimumClientVersion
  if (-not $minimum) { throw 'release manifest minimumClientVersion must be semver-like x.y.z' }
  $gte = [regex]::Match($Range, '^>=(\d+\.\d+\.\d+)$')
  if ($gte.Success) {
    $lower = Convert-VersionTriple $gte.Groups[1].Value
    if ((-not $lower) -or ((Compare-VersionTriple $minimum $lower) -lt 0)) {
      throw 'release manifest supportedClientRange must include minimumClientVersion'
    }
    return
  }
  $between = [regex]::Match($Range, '^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$')
  if ($between.Success) {
    $lower = Convert-VersionTriple $between.Groups[1].Value
    $upper = Convert-VersionTriple $between.Groups[2].Value
    if ((-not $lower) -or (-not $upper) -or ((Compare-VersionTriple $lower $upper) -gt 0)) {
      throw 'release manifest supportedClientRange bounds are invalid'
    }
    if (((Compare-VersionTriple $minimum $lower) -lt 0) -or ((Compare-VersionTriple $minimum $upper) -gt 0)) {
      throw 'release manifest supportedClientRange must include minimumClientVersion'
    }
    return
  }
  throw 'release manifest supportedClientRange must be >=x.y.z or x.y.z - a.b.c'
}

function Assert-PublicHttpsUrl([string]$Value, [string]$FieldName) {
  try {
    $uri = [System.Uri]::new($Value)
  } catch {
    throw "$FieldName must be a valid public https URL"
  }
  if ($uri.Scheme -ne 'https') { throw "$FieldName must use https" }
  if ($uri.Host -eq 'localhost' -or $uri.Host -eq '127.0.0.1' -or $uri.Host.EndsWith('.local')) {
    throw "$FieldName must be public-safe"
  }
}

function Write-StatusJson([hashtable]$Status, [string]$PathValue) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PathValue) | Out-Null
  $Status | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $PathValue -Encoding UTF8
}

function Get-CopyPlan([string]$SourceRoot) {
  $sourcePrefixLength = (Convert-ToFullPath $SourceRoot).Length + 1
  Get-ChildItem -LiteralPath $SourceRoot -Recurse -File -Force |
    ForEach-Object {
      $relative = $_.FullName.Substring($sourcePrefixLength)
      if (Test-IsExcludedRelativePath $relative) { return }
      [pscustomobject]@{
        relativePath = $relative
        source = $_.FullName
        bytes = $_.Length
      }
    }
}

function Copy-PlannedFiles([array]$Plan, [string]$DestinationRoot) {
  foreach ($file in $Plan) {
    $destination = Join-Path $DestinationRoot $file.relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.source -Destination $destination -Force
  }
}

function Invoke-SmokeChecks([string]$PublicUrl) {
  $checks = @(
    @{ name = 'runner-health'; uri = 'http://127.0.0.1:8790/api/health' },
    @{ name = 'runner-skills'; uri = 'http://127.0.0.1:8790/api/skills' },
    @{ name = 'vite-proxy-skills'; uri = 'http://127.0.0.1:5173/api/skills' }
  )
  if ($PublicUrl) { $checks += @{ name = 'public-health'; uri = "$PublicUrl/api/health" } }
  foreach ($check in $checks) {
    try {
      Invoke-RestMethod -Uri $check.uri -TimeoutSec 5 | Out-Null
      [pscustomobject]@{ name = $check.name; uri = $check.uri; ok = $true }
    } catch {
      [pscustomobject]@{ name = $check.name; uri = $check.uri; ok = $false; error = $_.Exception.Message }
    }
  }
}

$sourceRoot = Convert-ToFullPath $ProjectRoot
$targetRootFull = Convert-ToFullPath $TargetRoot
$manifest = Read-ReleaseManifest $ManifestPath
$releaseTrainId = if ($manifest -and $manifest.releaseTrainId) { [string]$manifest.releaseTrainId } else { '' }
$manifestClientVersion = if ($manifest -and $manifest.clientVersion) { [string]$manifest.clientVersion } else { '' }
$manifestBackendVersion = if ($manifest -and $manifest.backendVersion) { [string]$manifest.backendVersion } else { '' }
$manifestMinimumClientVersion = if ($manifest -and $manifest.minimumClientVersion) { [string]$manifest.minimumClientVersion } else { '' }
$manifestSupportedClientRange = if ($manifest -and $manifest.supportedClientRange) { [string]$manifest.supportedClientRange } else { '' }
$manifestLatestClientUrl = if ($manifest -and $manifest.latestClientUrl) { [string]$manifest.latestClientUrl } else { '' }
$manifestReleaseNotesUrl = if ($manifest -and $manifest.releaseNotesUrl) { [string]$manifest.releaseNotesUrl } else { '' }
$publicUrl = 'https://y3toolbox.b4im.com'

$status = [ordered]@{
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  terminalState = 'planning'
  releaseTrainId = $releaseTrainId
  projectRoot = $sourceRoot
  targetRoot = $targetRootFull
  manifestPath = $ManifestPath
  manifestClientVersion = $manifestClientVersion
  manifestBackendVersion = $manifestBackendVersion
  manifestMinimumClientVersion = $manifestMinimumClientVersion
  manifestSupportedClientRange = $manifestSupportedClientRange
  manifestLatestClientUrl = $manifestLatestClientUrl
  manifestReleaseNotesUrl = $manifestReleaseNotesUrl
  dryRun = -not $Apply
  apply = [bool]$Apply
  restartPublic = [bool]$RestartPublic
  rollback = [bool]$Rollback
  maintenanceRequested = [bool]($EnableMaintenance -or $DisableMaintenance)
  copiedFileCount = 0
  excludedRelativeRoots = $ExcludedRelativeRoots
  steps = @()
}

try {
  if ($RestartPublic -and -not $Apply) { throw '-RestartPublic requires -Apply.' }
  if ($Rollback -and -not $Apply) { throw '-Rollback requires -Apply.' }
  if ($EnableMaintenance -and $DisableMaintenance) { throw 'Use only one of -EnableMaintenance or -DisableMaintenance.' }
  if ($Apply -or $RestartPublic) { Require-ReleaseManifest $manifest $ManifestPath }
  if ((Convert-ToFullPath $sourceRoot).Equals($targetRootFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'TargetRoot must not equal ProjectRoot.' }
  if (Test-IsSubPath $targetRootFull $sourceRoot) { throw 'TargetRoot must not be inside the development checkout.' }
  if (Test-IsSubPath $sourceRoot $targetRootFull) { throw 'ProjectRoot must not be inside TargetRoot.' }
  if ($targetRootFull -notmatch 'public-runtime$') { throw 'TargetRoot must end with public-runtime for safety.' }
  $status.steps += @{ name = 'validated-target-root'; state = 'ok' }

  $copyPlan = @(Get-CopyPlan $sourceRoot)
  $status.plannedFileCount = $copyPlan.Count
  $status.plannedBytes = ($copyPlan | Measure-Object -Property bytes -Sum).Sum

  if (-not $Apply) {
    $status.terminalState = 'dry-run'
    $status.steps += @{ name = 'copy'; state = 'dry-run'; plannedFileCount = $copyPlan.Count }
    Write-StatusJson $status $StatusPath
    $status | ConvertTo-Json -Depth 20
    exit 0
  }

  if (-not (Test-Path -LiteralPath $targetRootFull)) {
    New-Item -ItemType Directory -Force -Path $targetRootFull | Out-Null
  }

  if ($Rollback) {
    $status.steps += @{ name = 'rollback-started'; state = 'not-implemented-for-this-target'; reason = 'No backup slot was supplied by this first-pass scaffold.' }
    $status.terminalState = 'rollback-failed'
    throw 'Rollback requires a previously captured backup slot; no automatic rollback was executed.'
  }

  if ($EnableMaintenance) { $status.steps += @{ name = 'maintenance-enabled'; state = 'requested'; mechanism = 'operator must start runner with AGENT_RUNNER_MAINTENANCE=1 or AGENT_RUNNER_DISABLE_SUBMISSIONS=1 before restart' } }
  if ($DisableMaintenance) { $status.steps += @{ name = 'maintenance-disabled'; state = 'requested'; mechanism = 'operator must restart runner without maintenance env after validation' } }

  Copy-PlannedFiles $copyPlan $targetRootFull
  $status.copiedFileCount = $copyPlan.Count
  $status.terminalState = 'synced'
  $status.steps += @{ name = 'copy'; state = 'applied'; copiedFileCount = $copyPlan.Count }

  if ($RestartPublic) {
    $status.steps += @{ name = 'restart-public'; state = 'started' }
    $stopScript = Join-Path $targetRootFull 'scripts\windows\stop-public-beta-backend.ps1'
    $startScript = Join-Path $targetRootFull 'scripts\windows\start-public-beta-backend.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript `
      -ReleaseTrainId $releaseTrainId `
      -LatestClientVersion $manifestClientVersion `
      -BackendVersion $manifestBackendVersion `
      -MinimumClientVersion $manifestMinimumClientVersion `
      -SupportedClientRange $manifestSupportedClientRange `
      -LatestClientUrl $manifestLatestClientUrl `
      -ReleaseNotesUrl $manifestReleaseNotesUrl
    $status.steps += @{ name = 'restart-public'; state = 'completed' }
    $status.terminalState = 'restarted'
    $status.smoke = @(Invoke-SmokeChecks $publicUrl)
    if (@($status.smoke | Where-Object { -not $_.ok }).Count -gt 0) {
      $status.terminalState = 'health-failed'
      throw 'Post-restart smoke checks failed.'
    }
    $status.terminalState = 'health-ok'
  }

  Write-StatusJson $status $StatusPath
  $status | ConvertTo-Json -Depth 20
} catch {
  $status.error = $_.Exception.Message
  if ($status.terminalState -eq 'planning') { $status.terminalState = 'failed' }
  Write-StatusJson $status $StatusPath
  $status | ConvertTo-Json -Depth 20
  throw
}
