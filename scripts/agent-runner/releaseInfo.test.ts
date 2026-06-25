import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentReleaseInfo } from './releaseInfo';

afterEach(() => vi.unstubAllEnvs());

describe('createAgentReleaseInfo', () => {
  it('builds public-safe release metadata from package version defaults', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-release-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');

    const release = createAgentReleaseInfo({ projectRoot: root });

    expect(release).toEqual({
      schemaVersion: 1,
      releaseTrainId: 'local-dev',
      clientVersion: '1.2.3',
      backendVersion: '1.2.3',
      minimumClientVersion: '1.2.3',
      supportedClientRange: '>=1.2.3',
      latestClientUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
      releaseNotesUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
    });
    expect(JSON.stringify(release)).not.toMatch(/[A-Za-z]:\\|\/mnt\/|AGENT_|TOKEN|SECRET|PASSWORD/i);
  });

  it('uses explicit public release environment values without leaking unrelated env', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-release-env-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');
    vi.stubEnv('AGENT_RELEASE_TRAIN_ID', 'train-2026-06-24');
    vi.stubEnv('AGENT_LATEST_CLIENT_VERSION', '1.3.0');
    vi.stubEnv('AGENT_BACKEND_VERSION', '2.0.1');
    vi.stubEnv('AGENT_BACKEND_COMMIT', 'abc1234');
    vi.stubEnv('AGENT_BACKEND_BUILT_AT', '2026-06-24T00:00:00.000Z');
    vi.stubEnv('AGENT_MINIMUM_CLIENT_VERSION', '1.2.0');
    vi.stubEnv('AGENT_SUPPORTED_CLIENT_RANGE', '>=1.2.0');
    vi.stubEnv('AGENT_LATEST_CLIENT_URL', 'https://example.invalid/download');
    vi.stubEnv('AGENT_RELEASE_NOTES_URL', 'https://example.invalid/notes');
    vi.stubEnv('AGENT_SECRET_TOKEN', 'must-not-leak');

    expect(createAgentReleaseInfo({ projectRoot: root })).toMatchObject({
      schemaVersion: 1,
      releaseTrainId: 'train-2026-06-24',
      clientVersion: '1.3.0',
      backendVersion: '2.0.1',
      backendCommit: 'abc1234',
      builtAt: '2026-06-24T00:00:00.000Z',
      minimumClientVersion: '1.2.0',
      supportedClientRange: '>=1.2.0',
      latestClientUrl: 'https://example.invalid/download',
      releaseNotesUrl: 'https://example.invalid/notes',
    });
    expect(JSON.stringify(createAgentReleaseInfo({ projectRoot: root }))).not.toContain('must-not-leak');
  });

  it('returns invalid fail-safe metadata instead of throwing on malformed public release configuration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-release-invalid-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.6' }), 'utf8');
    const originalRange = process.env.AGENT_SUPPORTED_CLIENT_RANGE;
    const originalUrl = process.env.AGENT_LATEST_CLIENT_URL;
    const originalClient = process.env.AGENT_LATEST_CLIENT_VERSION;
    try {
      process.env.AGENT_SUPPORTED_CLIENT_RANGE = '^0.1.0';
      expect(createAgentReleaseInfo({ projectRoot: root })).toMatchObject({
        schemaVersion: 1,
        clientVersion: 'invalid',
        backendVersion: 'invalid',
        minimumClientVersion: 'invalid',
        supportedClientRange: 'invalid',
        latestClientUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
      });
      process.env.AGENT_SUPPORTED_CLIENT_RANGE = '>=0.1.6';
      process.env.AGENT_LATEST_CLIENT_VERSION = '0.1.6-beta.1';
      expect(createAgentReleaseInfo({ projectRoot: root })).toMatchObject({
        schemaVersion: 1,
        clientVersion: 'invalid',
        supportedClientRange: 'invalid',
      });
      delete process.env.AGENT_LATEST_CLIENT_VERSION;
      process.env.AGENT_SUPPORTED_CLIENT_RANGE = '>=0.1.6';
      process.env.AGENT_LATEST_CLIENT_URL = 'http://127.0.0.1/download';
      expect(createAgentReleaseInfo({ projectRoot: root })).toMatchObject({
        schemaVersion: 1,
        clientVersion: 'invalid',
        latestClientUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
      });
    } finally {
      if (originalRange === undefined) {
        delete process.env.AGENT_SUPPORTED_CLIENT_RANGE;
      } else {
        process.env.AGENT_SUPPORTED_CLIENT_RANGE = originalRange;
      }
      if (originalUrl === undefined) {
        delete process.env.AGENT_LATEST_CLIENT_URL;
      } else {
        process.env.AGENT_LATEST_CLIENT_URL = originalUrl;
      }
      if (originalClient === undefined) {
        delete process.env.AGENT_LATEST_CLIENT_VERSION;
      } else {
        process.env.AGENT_LATEST_CLIENT_VERSION = originalClient;
      }
    }
  });

  it('emits invalid fail-closed metadata when package version is unavailable instead of using 0.0.0 compatibility', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-release-missing-package-'));

    expect(createAgentReleaseInfo({ projectRoot: root })).toMatchObject({
      schemaVersion: 1,
      clientVersion: 'invalid',
      backendVersion: 'invalid',
      minimumClientVersion: 'invalid',
      supportedClientRange: 'invalid',
      latestClientUrl: 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest',
    });
  });
});
