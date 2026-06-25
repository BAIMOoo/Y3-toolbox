import { describe, expect, it } from 'vitest';
import { DEFAULT_LATEST_CLIENT_URL, evaluateAgentCompatibility } from './agentCompatibility';
import type { AgentReleaseInfo } from './types';

const release: AgentReleaseInfo = {
  schemaVersion: 1,
  releaseTrainId: 'train-2026.06.24',
  clientVersion: '0.1.6',
  backendVersion: '0.2.0',
  minimumClientVersion: '0.1.6',
  supportedClientRange: '>=0.1.6',
  latestClientUrl: 'https://example.invalid/latest',
  releaseNotesUrl: 'https://example.invalid/notes',
};

describe('agent compatibility evaluator', () => {
  it('allows the exact minimum client version', () => {
    expect(evaluateAgentCompatibility(release, '0.1.6')).toMatchObject({
      compatible: true,
      submitBlocked: false,
      reason: 'compatible',
      statusLabel: '客户端兼容',
    });
  });

  it('blocks stale clients below minimum version', () => {
    expect(evaluateAgentCompatibility(release, '0.1.5')).toMatchObject({
      compatible: false,
      submitBlocked: true,
      reason: 'stale-client',
      statusLabel: '客户端需要更新',
      latestClientUrl: 'https://example.invalid/latest',
    });
  });

  it('supports bounded first-pass ranges', () => {
    const bounded = { ...release, minimumClientVersion: '0.1.4', supportedClientRange: '0.1.4 - 0.1.8' };

    expect(evaluateAgentCompatibility(bounded, '0.1.7').compatible).toBe(true);
    expect(evaluateAgentCompatibility(bounded, '0.1.9')).toMatchObject({
      compatible: false,
      submitBlocked: true,
      reason: 'unsupported-client',
    });
  });

  it('fails closed when release metadata is missing', () => {
    expect(evaluateAgentCompatibility(undefined, '0.1.6')).toMatchObject({
      compatible: false,
      submitBlocked: true,
      reason: 'missing-release',
      latestClientUrl: DEFAULT_LATEST_CLIENT_URL,
    });
  });

  it('fails closed for malformed schema, versions, or ranges', () => {
    expect(evaluateAgentCompatibility({ ...release, schemaVersion: 2 as 1 }, '0.1.6').reason).toBe('invalid-release');
    expect(evaluateAgentCompatibility({ ...release, minimumClientVersion: 'latest' }, '0.1.6').reason).toBe('invalid-release');
    expect(evaluateAgentCompatibility({ ...release, supportedClientRange: '^0.1.0' }, '0.1.6').reason).toBe('invalid-release');
    expect(evaluateAgentCompatibility(release, '0.1.6-beta.1')).toMatchObject({
      compatible: false,
      submitBlocked: true,
      reason: 'invalid-release',
    });
  });

  it('fails closed when supported range contradicts the authoritative minimum', () => {
    expect(evaluateAgentCompatibility({
      ...release,
      minimumClientVersion: '0.1.6',
      supportedClientRange: '0.1.0 - 0.1.5',
    }, '0.1.6')).toMatchObject({ reason: 'invalid-release', submitBlocked: true });
  });

  it('uses GitHub Releases fallback when latest URL is absent', () => {
    expect(evaluateAgentCompatibility({ ...release, latestClientUrl: undefined }, '0.1.5')).toMatchObject({
      latestClientUrl: DEFAULT_LATEST_CLIENT_URL,
      releaseNotesUrl: 'https://example.invalid/notes',
    });
  });
});
