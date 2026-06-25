import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(path.join(process.cwd(), 'scripts/windows/start-public-beta-backend.ps1'), 'utf8');

describe('Windows public beta backend startup contract', () => {
  it('enables trusted proxy source identity for both Vite and runner', () => {
    expect(script).toContain("AGENT_RUNNER_TRUST_PROXY = '1'");
    expect(script).toMatch(/\$runnerEnv = @\{[\s\S]*AGENT_RUNNER_TRUST_PROXY = '1'[\s\S]*\}/);
    expect(script).toMatch(/\$viteEnv = @\{[^}]*AGENT_RUNNER_TRUST_PROXY = '1'[^}]*\}/);
    expect(script).toContain('trustProxy = $true');
  });

  it('configures a server-owned KKRes public input root for public identifiers', () => {
    expect(script).toContain('[string]$KkresPublicInputRoot');
    expect(script).toContain('[string]$KkresProjectPath');
    expect(script).toContain("Join-Path $ProjectRoot '.omx\\public-input'");
    expect(script).toContain("Join-Path $KkresPublicInputRoot 'staging'");
    expect(script).toContain('AGENT_KKRES_PUBLIC_INPUT_ROOT = $KkresPublicInputRoot');
    expect(script).toContain('AGENT_KKRES_PROJECT_PATH = $KkresProjectPath');
    expect(script).toContain('kkresPublicInputRoot = $KkresPublicInputRoot');
    expect(script).toContain('kkresProjectPath = $KkresProjectPath');
  });

  it('uses the fixed Cloudflare named tunnel by default instead of a random quick tunnel', () => {
    expect(script).toContain("[string]$CloudflareTunnelName = 'y3-toolbox-public'");
    expect(script).toContain("[string]$PublicUrl = 'https://y3toolbox.b4im.com'");
    expect(script).toContain('[switch]$UseQuickTunnel');
    expect(script).toContain("$cloudflaredArgs = @('tunnel', 'run', '--url', \"http://127.0.0.1:$VitePort\", $CloudflareTunnelName)");
    expect(script).toContain("$tunnelUrl = $PublicUrl");
    expect(script).toContain('cloudflareTunnelName = if ($SkipCloudflared -or $UseQuickTunnel) { $null } else { $CloudflareTunnelName }');
  });

  it('starts the runner directly with the configured 5/10 capacity limits', () => {
    expect(script).toContain('[int]$MaxConcurrentJobs = 5');
    expect(script).toContain('[int]$MaxQueuedJobs = 10');
    expect(script).toContain("AGENT_RUNNER_MAX_CONCURRENT = [string]$MaxConcurrentJobs");
    expect(script).toContain("AGENT_RUNNER_MAX_QUEUED = [string]$MaxQueuedJobs");
    expect(script).toContain("-FilePath $npx -ArgumentList @('tsx', 'scripts/agent-runner/index.ts')");
    expect(script).toContain('maxConcurrentJobs = $MaxConcurrentJobs');
    expect(script).toContain('maxQueuedJobs = $MaxQueuedJobs');
  });


  it('passes explicit release-train metadata to the public runner instead of local-dev provenance', () => {
    expect(script).toContain('[string]$ReleaseTrainId');
    expect(script).toContain('[string]$ManifestPath');
    expect(script).toContain('function Read-ReleaseManifest');
    expect(script).toContain('function Require-PublicReleaseMetadata');
    expect(script).toContain("throw \"Public release metadata is required before startup: $field\"");
    expect(script).toContain("if (-not $ManifestPath) { $ManifestPath = Join-Path $ProjectRoot 'release\\release-manifest.json' }");
    expect(script).toContain('Use-ManifestReleaseMetadata (Read-ReleaseManifest $ManifestPath)');
    expect(script).not.toContain('function Read-PackageVersion');
    expect(script).not.toContain('if (-not $ReleaseTrainId) { $ReleaseTrainId = "v$packageVersion" }');
    expect(script).toContain('AGENT_RELEASE_TRAIN_ID = $ReleaseTrainId');
    expect(script).toContain('AGENT_LATEST_CLIENT_VERSION = $LatestClientVersion');
    expect(script).toContain('AGENT_BACKEND_VERSION = $BackendVersion');
    expect(script).toContain('AGENT_MINIMUM_CLIENT_VERSION = $MinimumClientVersion');
    expect(script).toContain('AGENT_SUPPORTED_CLIENT_RANGE = $SupportedClientRange');
    expect(script).toContain('releaseTrainId = $ReleaseTrainId');
    expect(script).toContain('manifestPath = $ManifestPath');
  });
});
