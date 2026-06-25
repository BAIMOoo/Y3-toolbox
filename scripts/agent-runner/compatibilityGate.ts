import type { AgentReleaseInfo } from '../../src/agentJobs/types';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

type ParsedRange =
  | { kind: 'minimum'; minimum: ParsedVersion }
  | { kind: 'between'; minimum: ParsedVersion; maximum: ParsedVersion };

export function assertClientCompatibleForSubmission(release: AgentReleaseInfo, clientVersion: unknown): void {
  const client = parseVersion(typeof clientVersion === 'string' ? clientVersion : '');
  const minimumClient = parseVersion(release.minimumClientVersion);
  const latestClient = parseVersion(release.clientVersion);
  const backend = parseVersion(release.backendVersion);
  const range = parseSupportedClientRange(release.supportedClientRange);

  if (release.schemaVersion !== 1 || !client || !minimumClient || !latestClient || !backend || !range) {
    throw new Error('Client compatibility cannot be verified; update the app before submitting jobs');
  }
  if (!rangeIncludes(range, minimumClient)) {
    throw new Error('Client compatibility cannot be verified; update the app before submitting jobs');
  }
  if (compareVersions(client, minimumClient) < 0) {
    throw new Error(`Client version ${formatVersion(client)} is below the minimum supported version ${release.minimumClientVersion}`);
  }
  if (!rangeIncludes(range, client)) {
    throw new Error(`Client version ${formatVersion(client)} is outside the supported range ${release.supportedClientRange}`);
  }
}

function parseVersion(value: string | undefined): ParsedVersion | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function parseSupportedClientRange(value: string | undefined): ParsedRange | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const minimumMatch = trimmed.match(/^>=(\d+\.\d+\.\d+)$/);
  if (minimumMatch) {
    const minimum = parseVersion(minimumMatch[1]);
    return minimum ? { kind: 'minimum', minimum } : null;
  }
  const betweenMatch = trimmed.match(/^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$/);
  if (betweenMatch) {
    const minimum = parseVersion(betweenMatch[1]);
    const maximum = parseVersion(betweenMatch[2]);
    if (!minimum || !maximum || compareVersions(minimum, maximum) > 0) return null;
    return { kind: 'between', minimum, maximum };
  }
  return null;
}

function rangeIncludes(range: ParsedRange, version: ParsedVersion): boolean {
  if (compareVersions(version, range.minimum) < 0) return false;
  if (range.kind === 'between' && compareVersions(version, range.maximum) > 0) return false;
  return true;
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function formatVersion(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
