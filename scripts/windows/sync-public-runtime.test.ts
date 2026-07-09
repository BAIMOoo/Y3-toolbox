import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(path.join(process.cwd(), 'scripts/windows/sync-public-runtime.ps1'), 'utf8');

function parseExcludedRelativeRoots(scriptSource: string): string[] {
  const match = scriptSource.match(/\$ExcludedRelativeRoots\s*=\s*@\((?<body>[\s\S]*?)\n\)/);
  if (!match?.groups?.body) {
    throw new Error('Could not parse $ExcludedRelativeRoots from sync-public-runtime.ps1');
  }
  return [...match.groups.body.matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function isExcludedRelativePath(relativePath: string, excludedRelativeRoots: string[]): boolean {
  const normalized = relativePath.replace(/\//g, '\\').toLocaleLowerCase('en-US');
  return excludedRelativeRoots.some((excluded) => {
    const normalizedExcluded = excluded.toLocaleLowerCase('en-US');
    return normalized === normalizedExcluded || normalized.startsWith(`${normalizedExcluded}\\`);
  });
}

describe('Windows public runtime sync script contract', () => {
  it('defaults to dry-run and records status JSON before mutation', () => {
    expect(script).toContain('[switch]$Apply');
    expect(script).toContain('dryRun = -not $Apply');
    expect(script).toContain("terminalState = 'dry-run'");
    expect(script).toContain('Write-StatusJson $status $StatusPath');
  });

  it('requires explicit Apply for public-impacting restart and rollback', () => {
    expect(script).toContain("if ($RestartPublic -and -not $Apply) { throw '-RestartPublic requires -Apply.' }");
    expect(script).toContain("if ($Rollback -and -not $Apply) { throw '-Rollback requires -Apply.' }");
    expect(script).toContain('[switch]$RestartPublic');
    expect(script).toContain('[switch]$Rollback');
  });

  it('rejects unsafe target roots and preserves public runtime isolation', () => {
    expect(script).toContain('TargetRoot must not equal ProjectRoot');
    expect(script).toContain('TargetRoot must not be inside the development checkout');
    expect(script).toContain('ProjectRoot must not be inside TargetRoot');
    expect(script).toContain('TargetRoot must end with public-runtime for safety');
  });

  it('excludes runtime, state, logs, dependencies, build outputs, private backend, and git data', () => {
    for (const fragment of [
      "'.git'",
      "'.local-tools'",
      "'node_modules'",
      "'dist-electron-build'",
      "'release-portable'",
      "'Y3-toolbox-backend-private'",
      "'.omx\\agent-jobs'",
      "'.omx\\dev-agent-jobs'",
      "'.omx\\public-input'",
      "'.omx\\dev-public-input'",
      "'.omx\\logs'",
      "'.omx\\state'",
      "'.omx\\tmp'",
    ]) {
      expect(script).toContain(fragment);
    }
    expect(script).not.toMatch(/mail[\\/]+secrets/i);
  });

  it('keeps public archive helper deliverables in the copy plan while excluding OMX state', () => {
    const excludedRelativeRoots = parseExcludedRelativeRoots(script);

    // .codex skill helper deliverables are shipped by the public runtime sync copy plan,
    // not by ordinary git diff, so they must not be filtered as runtime-only state.
    expect(isExcludedRelativePath('.codex\\skills\\fetch-archive-changes\\scripts\\fetch_archive_changes.py', excludedRelativeRoots)).toBe(false);
    expect(isExcludedRelativePath('.codex\\skills\\fetch-archive-changes\\SKILL.md', excludedRelativeRoots)).toBe(false);
    expect(isExcludedRelativePath('.omx\\state', excludedRelativeRoots)).toBe(true);
    expect(isExcludedRelativePath('.omx\\state\\sync-public-runtime-status.json', excludedRelativeRoots)).toBe(true);
  });

  it('requires and forwards release manifest metadata for apply and public restart', () => {
    expect(script).toContain('function Require-ReleaseManifest');
    expect(script).toContain('Release manifest is required for -Apply/-RestartPublic');
    expect(script).toContain("foreach ($field in @('releaseTrainId', 'clientVersion', 'backendVersion', 'minimumClientVersion', 'supportedClientRange', 'latestClientUrl', 'releaseNotesUrl'))");
    expect(script).toContain('if ($Apply -or $RestartPublic) { Require-ReleaseManifest $manifest $ManifestPath }');
    expect(script).toContain("Assert-SupportedClientRange ([string]$Manifest.supportedClientRange) ([string]$Manifest.minimumClientVersion)");
    expect(script).toContain("throw 'release manifest supportedClientRange must include minimumClientVersion'");
    expect(script).toContain("Assert-PublicHttpsUrl ([string]$Manifest.latestClientUrl) 'release manifest latestClientUrl'");
    expect(script).toContain("Assert-PublicHttpsUrl ([string]$Manifest.releaseNotesUrl) 'release manifest releaseNotesUrl'");
    expect(script).toContain('-ReleaseTrainId $releaseTrainId');
    expect(script).toContain('-LatestClientVersion $manifestClientVersion');
    expect(script).toContain('-BackendVersion $manifestBackendVersion');
    expect(script).toContain('-MinimumClientVersion $manifestMinimumClientVersion');
    expect(script).toContain('-SupportedClientRange $manifestSupportedClientRange');
    expect(script).toContain('-LatestClientUrl $manifestLatestClientUrl');
    expect(script).toContain('-ReleaseNotesUrl $manifestReleaseNotesUrl');
    expect(script).toContain('manifestLatestClientUrl = $manifestLatestClientUrl');
    expect(script).toContain('manifestReleaseNotesUrl = $manifestReleaseNotesUrl');
  });

  it('records restart, health, rollback, and maintenance state without weakening guardrails', () => {
    expect(script).toContain('Invoke-SmokeChecks');
    expect(script).toContain('http://127.0.0.1:8790/api/health');
    expect(script).toContain('http://127.0.0.1:8790/api/skills');
    expect(script).toContain('http://127.0.0.1:5173/api/skills');
    expect(script).toContain("terminalState = 'health-failed'");
    expect(script).toContain("terminalState = 'health-ok'");
    expect(script).toContain("terminalState = 'rollback-failed'");
    expect(script).toContain('AGENT_RUNNER_MAINTENANCE=1');
    expect(script).toContain('AGENT_RUNNER_DISABLE_SUBMISSIONS=1');
  });
});
