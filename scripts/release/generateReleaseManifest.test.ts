import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReleaseManifest, createReleaseManifestInputFromEnv } from './generateReleaseManifest';

const baseInput = {
  projectRoot: '/repo',
  releaseTrainId: 'v0.1.6',
  clientVersion: '0.1.6',
  backendVersion: '0.2.0',
  minimumClientVersion: '0.1.6',
  supportedClientRange: '>=0.1.6',
  commit: 'abc123',
  builtAt: '2026-06-24T07:00:00.000Z',
  releaseTag: 'v0.1.6',
  latestClientUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
  releaseNotesUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
  publicRuntimeTarget: 'configured-public-runtime',
  portableArtifactName: 'Y3-Toolbox-0.1.6.exe',
};

describe('release manifest generator', () => {
  it('builds deterministic candidate metadata and checklist without changing portable packaging', () => {
    expect(buildReleaseManifest(baseInput)).toEqual({
      schemaVersion: 1,
      releaseTrainId: 'v0.1.6',
      clientVersion: '0.1.6',
      backendVersion: '0.2.0',
      minimumClientVersion: '0.1.6',
      supportedClientRange: '>=0.1.6',
      commit: 'abc123',
      builtAt: '2026-06-24T07:00:00.000Z',
      releaseTag: 'v0.1.6',
      latestClientUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
      releaseNotesUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
      publicRuntimeTarget: 'configured-public-runtime',
      portableArtifactName: 'Y3-Toolbox-0.1.6.exe',
      verification: {
        requiredCommands: ['npx tsc -b --pretty false', 'npm run lint', 'npm run test'],
        workflowEvidence: {
          typecheck: 'GitHub Actions Typecheck step must pass before this manifest is published.',
          lint: 'GitHub Actions Lint step must pass before this manifest is published.',
          test: 'GitHub Actions Test step must pass before this manifest is published.',
          portablePackaging: 'GitHub Actions Build Electron package step keeps the existing portable Windows target.',
        },
      },
      promotion: {
        canonicalScript: 'scripts/windows/sync-public-runtime.ps1',
        status: 'candidate',
        dryRunDefault: true,
        restartRequiresExplicitFlag: true,
        rollbackSupported: true,
      },
    });
  });

  it('rejects invalid versions and unsupported ranges', () => {
    expect(() => buildReleaseManifest({ ...baseInput, clientVersion: 'latest' })).toThrow(/clientVersion/);
    expect(() => buildReleaseManifest({ ...baseInput, clientVersion: '0.1.6-beta.1' })).toThrow(/clientVersion/);
    expect(() => buildReleaseManifest({ ...baseInput, supportedClientRange: '^0.1.0' })).toThrow(/supportedClientRange/);
    expect(() => buildReleaseManifest({ ...baseInput, minimumClientVersion: '0.1.6', supportedClientRange: '0.1.0 - 0.1.5' })).toThrow(/include minimumClientVersion/);
  });

  it('derives required fields from package and explicit workflow environment', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-manifest-'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.6' }), 'utf8');

    expect(createReleaseManifestInputFromEnv(root, {
      RELEASE_BACKEND_VERSION: '0.2.0',
      RELEASE_MINIMUM_CLIENT_VERSION: '0.1.6',
      RELEASE_SUPPORTED_CLIENT_RANGE: '>=0.1.6',
      RELEASE_COMMIT: 'abc123',
      RELEASE_BUILT_AT: '2026-06-24T07:00:00.000Z',
      RELEASE_TAG: 'v0.1.6',
    })).toMatchObject({
      clientVersion: '0.1.6',
      backendVersion: '0.2.0',
      releaseTrainId: 'v0.1.6',
      supportedClientRange: '>=0.1.6',
      publicRuntimeTarget: 'configured-public-runtime',
      portableArtifactName: 'Y3-Toolbox-0.1.6.exe',
    });
  });

  it('does not publish machine-local public runtime paths in the release manifest', () => {
    expect(JSON.stringify(buildReleaseManifest(baseInput))).not.toMatch(/[A-Za-z]:\\|\/mnt\//);
    expect(JSON.stringify(buildReleaseManifest(baseInput))).not.toContain('publicRuntimeTargetRoot');
  });

  it('requires explicit backend version, minimum client, supported range, and build timestamp', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-manifest-required-'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.6' }), 'utf8');

    expect(() => createReleaseManifestInputFromEnv(root, {
      RELEASE_COMMIT: 'abc123',
      RELEASE_BUILT_AT: '2026-06-24T07:00:00.000Z',
    })).toThrow(/RELEASE_BACKEND_VERSION/);
    expect(() => createReleaseManifestInputFromEnv(root, {
      RELEASE_BACKEND_VERSION: '0.2.0',
      RELEASE_COMMIT: 'abc123',
      RELEASE_BUILT_AT: '2026-06-24T07:00:00.000Z',
    })).toThrow(/RELEASE_MINIMUM_CLIENT_VERSION/);
    expect(() => createReleaseManifestInputFromEnv(root, {
      RELEASE_BACKEND_VERSION: '0.2.0',
      RELEASE_MINIMUM_CLIENT_VERSION: '0.1.6',
      RELEASE_COMMIT: 'abc123',
      RELEASE_BUILT_AT: '2026-06-24T07:00:00.000Z',
    })).toThrow(/RELEASE_SUPPORTED_CLIENT_RANGE/);
    expect(() => createReleaseManifestInputFromEnv(root, {
      RELEASE_BACKEND_VERSION: '0.2.0',
      RELEASE_MINIMUM_CLIENT_VERSION: '0.1.6',
      RELEASE_SUPPORTED_CLIENT_RANGE: '>=0.1.6',
      RELEASE_COMMIT: 'abc123',
    })).toThrow(/RELEASE_BUILT_AT/);
  });

});
