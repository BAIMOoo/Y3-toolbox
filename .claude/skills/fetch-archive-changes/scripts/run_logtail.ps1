$ErrorActionPreference = 'Stop'

if ($args.Count -lt 1) {
  Write-Error 'Usage: run_logtail.ps1 <logtail.exe> [logtail args...]'
  exit 2
}

$logtailPath = [string]$args[0]
if ($args.Count -gt 1) {
  $logtailArgs = [string[]]$args[1..($args.Count - 1)]
} else {
  $logtailArgs = @()
}

& $logtailPath @logtailArgs
exit $LASTEXITCODE
