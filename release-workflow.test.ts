import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GitHub release workflow contract', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

  it('keeps the existing portable Windows package path', () => {
    expect(workflow).toContain('npm run build:electron -- --publish never');
    expect(workflow).toContain("Where-Object { $_.Name -notlike '*Setup*' }");
    expect(workflow).toContain('release/Y3-Toolbox-$version.exe');
    expect(workflow).not.toContain('nsis');
    expect(workflow).not.toContain('msix');
    expect(workflow).not.toContain('squirrel');
  });

  it('generates and publishes the release train manifest with the portable exe', () => {
    expect(workflow).toContain('Generate release train manifest');
    expect(workflow).toContain('backend_version:');
    expect(workflow).toContain('minimum_client_version:');
    expect(workflow).toContain('supported_client_range:');
    expect(workflow).toContain('RELEASE_BACKEND_VERSION: ${{ inputs.backend_version }}');
    expect(workflow).toContain('RELEASE_MINIMUM_CLIENT_VERSION: ${{ inputs.minimum_client_version }}');
    expect(workflow).toContain('RELEASE_SUPPORTED_CLIENT_RANGE: ${{ inputs.supported_client_range }}');
    expect(workflow).toContain("throw 'backend_version workflow input is required'");
    expect(workflow).toContain('$env:RELEASE_BUILT_AT = (Get-Date).ToUniversalTime().ToString("o")');
    expect(workflow).toContain('scripts/release/generateReleaseManifest.ts --output release/release-manifest.json');
    expect(workflow).toContain('release/release-manifest.json');
    expect(workflow).toContain('release/*.exe');
    expect(workflow).not.toContain('RELEASE_PUBLIC_RUNTIME_TARGET_ROOT');
    expect(workflow).not.toMatch(/[A-Za-z]:\\/);
  });

  it('publishes only from explicit dispatch inputs and pins the tag to the built commit', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('push:');
    expect(workflow).not.toContain('vars.RELEASE_');
    expect(workflow).toContain('RELEASE_TAG: ${{ inputs.release_tag }}');
    expect(workflow).toContain('target_commitish: ${{ github.sha }}');
    expect(workflow).toContain('Reject an existing release identity');
    expect(workflow).toContain("if ($exists) { throw \"$($candidate.label) already exists: $env:RELEASE_TAG\" }");
    expect(workflow).toContain('group: release-windows-app');
  });
});
