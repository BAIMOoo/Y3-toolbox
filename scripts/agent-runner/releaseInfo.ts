import fs from 'node:fs';
import path from 'node:path';
import type { AgentReleaseInfo } from '../../src/agentJobs/types';
import type { RunnerConfig } from './contracts';

const DEFAULT_RELEASE_TRAIN = 'local-dev';
const INVALID_RELEASE_VALUE = 'invalid';
const PUBLIC_DOWNLOAD_URL = 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest';

interface PackageJsonVersion {
  version?: unknown;
}

function readPackageVersion(projectRoot: string): string | null {
  try {
    const packagePath = path.join(projectRoot, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as PackageJsonVersion;
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function cleanValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function envValue(name: string): string {
  return cleanValue(process.env[name]);
}

function configOrEnv(configValue: unknown, envName: string): string {
  return cleanValue(configValue) || envValue(envName);
}

export function createAgentReleaseInfo(config: Pick<RunnerConfig, 'projectRoot'> & Partial<Pick<RunnerConfig, 'agentReleaseTrainId' | 'agentLatestClientVersion' | 'agentBackendVersion' | 'agentBackendCommit' | 'agentBackendBuiltAt' | 'agentMinimumClientVersion' | 'agentSupportedClientRange' | 'agentLatestClientUrl' | 'agentReleaseNotesUrl'>>): AgentReleaseInfo {
  const packageVersion = readPackageVersion(config.projectRoot);
  const minimumClientVersion = configOrEnv(config.agentMinimumClientVersion, 'AGENT_MINIMUM_CLIENT_VERSION') || packageVersion || INVALID_RELEASE_VALUE;
  const supportedClientRange = configOrEnv(config.agentSupportedClientRange, 'AGENT_SUPPORTED_CLIENT_RANGE') || (packageVersion ? `>=${minimumClientVersion}` : INVALID_RELEASE_VALUE);
  const release: AgentReleaseInfo = {
    schemaVersion: 1,
    releaseTrainId: cleanValue(config.agentReleaseTrainId) || envValue('AGENT_RELEASE_TRAIN_ID') || envValue('RELEASE_TRAIN_ID') || DEFAULT_RELEASE_TRAIN,
    clientVersion: configOrEnv(config.agentLatestClientVersion, 'AGENT_LATEST_CLIENT_VERSION') || packageVersion || INVALID_RELEASE_VALUE,
    backendVersion: configOrEnv(config.agentBackendVersion, 'AGENT_BACKEND_VERSION') || packageVersion || INVALID_RELEASE_VALUE,
    ...(configOrEnv(config.agentBackendCommit, 'AGENT_BACKEND_COMMIT') ? { backendCommit: configOrEnv(config.agentBackendCommit, 'AGENT_BACKEND_COMMIT') } : {}),
    ...(configOrEnv(config.agentBackendBuiltAt, 'AGENT_BACKEND_BUILT_AT') ? { builtAt: configOrEnv(config.agentBackendBuiltAt, 'AGENT_BACKEND_BUILT_AT') } : {}),
    minimumClientVersion,
    supportedClientRange,
    latestClientUrl: configOrEnv(config.agentLatestClientUrl, 'AGENT_LATEST_CLIENT_URL') || PUBLIC_DOWNLOAD_URL,
    releaseNotesUrl: configOrEnv(config.agentReleaseNotesUrl, 'AGENT_RELEASE_NOTES_URL') || PUBLIC_DOWNLOAD_URL,
  };
  if (hasInvalidSentinel(release)) return invalidAgentReleaseInfo(release.releaseTrainId);
  try {
    validateAgentReleaseInfo(release);
    return release;
  } catch {
    return invalidAgentReleaseInfo(release.releaseTrainId);
  }
}

function invalidAgentReleaseInfo(releaseTrainId: string): AgentReleaseInfo {
  return {
    schemaVersion: 1,
    releaseTrainId: releaseTrainId.trim() || DEFAULT_RELEASE_TRAIN,
    clientVersion: INVALID_RELEASE_VALUE,
    backendVersion: INVALID_RELEASE_VALUE,
    minimumClientVersion: INVALID_RELEASE_VALUE,
    supportedClientRange: INVALID_RELEASE_VALUE,
    latestClientUrl: PUBLIC_DOWNLOAD_URL,
    releaseNotesUrl: PUBLIC_DOWNLOAD_URL,
  };
}

function hasInvalidSentinel(release: AgentReleaseInfo): boolean {
  return release.clientVersion === INVALID_RELEASE_VALUE
    || release.backendVersion === INVALID_RELEASE_VALUE
    || release.minimumClientVersion === INVALID_RELEASE_VALUE
    || release.supportedClientRange === INVALID_RELEASE_VALUE;
}

function validateAgentReleaseInfo(release: AgentReleaseInfo): void {
  for (const [field, value] of Object.entries({
    releaseTrainId: release.releaseTrainId,
    clientVersion: release.clientVersion,
    backendVersion: release.backendVersion,
    minimumClientVersion: release.minimumClientVersion,
    supportedClientRange: release.supportedClientRange,
  })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`release.${field} is required`);
  }
  assertSemver(release.clientVersion, 'release.clientVersion');
  assertSemver(release.backendVersion, 'release.backendVersion');
  assertSemver(release.minimumClientVersion, 'release.minimumClientVersion');
  assertSupportedClientRange(release.supportedClientRange, release.minimumClientVersion);
  assertPublicHttpsUrl(release.latestClientUrl, 'release.latestClientUrl');
  assertPublicHttpsUrl(release.releaseNotesUrl, 'release.releaseNotesUrl');
}

function assertSemver(value: string, label: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`${label} must be semver-like x.y.z`);
}

function assertSupportedClientRange(range: string, minimumClientVersion: string): void {
  const parsedMinimum = parseVersion(minimumClientVersion);
  if (!parsedMinimum) throw new Error('release.minimumClientVersion must be semver-like x.y.z');
  const gte = range.match(/^>=(\d+\.\d+\.\d+)$/);
  if (gte) {
    const lower = parseVersion(gte[1]);
    if (!lower || compareVersions(parsedMinimum, lower) < 0) throw new Error('release.supportedClientRange must include minimumClientVersion');
    return;
  }
  const between = range.match(/^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$/);
  if (between) {
    const lower = parseVersion(between[1]);
    const upper = parseVersion(between[2]);
    if (!lower || !upper || compareVersions(lower, upper) > 0) throw new Error('release.supportedClientRange bounds are invalid');
    if (compareVersions(parsedMinimum, lower) < 0 || compareVersions(parsedMinimum, upper) > 0) throw new Error('release.supportedClientRange must include minimumClientVersion');
    return;
  }
  throw new Error('release.supportedClientRange must be >=x.y.z or x.y.z - a.b.c');
}

function assertPublicHttpsUrl(value: string | undefined, label: string): void {
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid public https URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use https`);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.local')) throw new Error(`${label} must be public-safe`);
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
