import type { AgentReleaseInfo } from './types';

export const Y3_TOOLBOX_CLIENT_VERSION = typeof __Y3_TOOLBOX_VERSION__ === 'string' && __Y3_TOOLBOX_VERSION__.trim()
  ? __Y3_TOOLBOX_VERSION__.trim()
  : '0.0.0';

export const DEFAULT_LATEST_CLIENT_URL = 'https://github.com/BAIMOoo/Y3-toolbox/releases/latest';

export type AgentCompatibilityTone = 'success' | 'warning' | 'error';

export interface AgentCompatibilityResult {
  compatible: boolean;
  submitBlocked: boolean;
  tone: AgentCompatibilityTone;
  statusLabel: string;
  message?: string;
  description?: string;
  currentClientVersion: string;
  latestClientVersion?: string;
  minimumClientVersion?: string;
  supportedClientRange?: string;
  latestClientUrl: string;
  releaseNotesUrl?: string;
  reason: 'compatible' | 'stale-client' | 'unsupported-client' | 'missing-release' | 'invalid-release';
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  label: string;
}

type ParsedRange =
  | { kind: 'minimum'; minimum: ParsedVersion }
  | { kind: 'between'; minimum: ParsedVersion; maximum: ParsedVersion };

export function evaluateAgentCompatibility(
  release: AgentReleaseInfo | null | undefined,
  clientVersion = Y3_TOOLBOX_CLIENT_VERSION,
): AgentCompatibilityResult {
  const currentClientVersion = clientVersion.trim();
  const fallbackUrl = release?.latestClientUrl?.trim() || DEFAULT_LATEST_CLIENT_URL;
  const releaseNotesUrl = release?.releaseNotesUrl?.trim() || fallbackUrl;

  if (!release) {
    return blocked('missing-release', currentClientVersion, fallbackUrl, releaseNotesUrl, {
      statusLabel: '需要更新确认',
      message: '无法确认任务服务兼容性',
      description: '任务服务没有提供版本兼容信息。为避免旧客户端提交不兼容任务，当前仅允许查看队列和已有结果，请更新到最新版本后再提交。',
    });
  }

  const client = parseVersion(currentClientVersion);
  const minimumClient = parseVersion(release.minimumClientVersion);
  const latestClient = parseVersion(release.clientVersion);
  const backend = parseVersion(release.backendVersion);
  const range = parseSupportedClientRange(release.supportedClientRange);
  if (release.schemaVersion !== 1 || !client || !minimumClient || !latestClient || !backend || !range) {
    return invalidRelease(release, currentClientVersion, fallbackUrl, releaseNotesUrl);
  }

  if (!rangeIncludes(range, minimumClient)) {
    return invalidRelease(release, currentClientVersion, fallbackUrl, releaseNotesUrl);
  }

  const common = {
    latestClientVersion: release.clientVersion,
    minimumClientVersion: release.minimumClientVersion,
    supportedClientRange: release.supportedClientRange,
  };

  if (compareVersions(client, minimumClient) < 0) {
    return blocked('stale-client', currentClientVersion, fallbackUrl, releaseNotesUrl, {
      ...common,
      statusLabel: '客户端需要更新',
      message: '当前客户端版本过旧，已暂停提交任务',
      description: `当前版本 ${currentClientVersion} 低于任务服务要求的最低版本 ${release.minimumClientVersion}。请下载最新版本后再提交，已有任务列表和结果仍可查看。`,
    });
  }

  if (!rangeIncludes(range, client)) {
    return blocked('unsupported-client', currentClientVersion, fallbackUrl, releaseNotesUrl, {
      ...common,
      statusLabel: '客户端版本不在支持范围',
      message: '当前客户端与任务服务版本不匹配',
      description: `当前版本 ${currentClientVersion} 不在任务服务支持范围 ${release.supportedClientRange} 内。请使用发布页中的兼容版本后再提交。`,
    });
  }

  return {
    compatible: true,
    submitBlocked: false,
    tone: 'success',
    statusLabel: '客户端兼容',
    currentClientVersion,
    latestClientVersion: release.clientVersion,
    minimumClientVersion: release.minimumClientVersion,
    supportedClientRange: release.supportedClientRange,
    latestClientUrl: fallbackUrl,
    releaseNotesUrl,
    reason: 'compatible',
  };
}

function invalidRelease(
  release: AgentReleaseInfo,
  currentClientVersion: string,
  latestClientUrl: string,
  releaseNotesUrl?: string,
): AgentCompatibilityResult {
  return blocked('invalid-release', currentClientVersion, latestClientUrl, releaseNotesUrl, {
    latestClientVersion: typeof release.clientVersion === 'string' ? release.clientVersion : undefined,
    minimumClientVersion: typeof release.minimumClientVersion === 'string' ? release.minimumClientVersion : undefined,
    supportedClientRange: typeof release.supportedClientRange === 'string' ? release.supportedClientRange : undefined,
    statusLabel: '兼容信息异常',
    message: '任务服务版本兼容信息异常',
    description: '任务服务返回的版本或兼容范围无法验证。为避免提交失败，当前仅允许查看队列和已有结果。',
  });
}

function blocked(
  reason: AgentCompatibilityResult['reason'],
  currentClientVersion: string,
  latestClientUrl: string,
  releaseNotesUrl: string | undefined,
  details: Pick<AgentCompatibilityResult, 'statusLabel' | 'message' | 'description'> & Partial<Pick<AgentCompatibilityResult, 'latestClientVersion' | 'minimumClientVersion' | 'supportedClientRange'>>,
): AgentCompatibilityResult {
  return {
    compatible: false,
    submitBlocked: true,
    tone: 'error',
    currentClientVersion,
    latestClientUrl,
    releaseNotesUrl,
    reason,
    ...details,
  };
}

function parseVersion(value: string | undefined): ParsedVersion | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    label: value.trim(),
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
