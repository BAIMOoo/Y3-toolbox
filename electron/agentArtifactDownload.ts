export interface SafeAgentArtifactDownloadRequest {
  url: URL;
  headers: Record<string, string>;
}

export function resolveSafeAgentArtifactDownloadRequest(value: unknown, configuredRunnerUrl: string): SafeAgentArtifactDownloadRequest {
  if (!isPlainObject(value) || typeof value.url !== 'string') throw new Error('Invalid artifact download request');
  const configuredBase = new URL(configuredRunnerUrl);
  if (!['http:', 'https:'].includes(configuredBase.protocol)) throw new Error('Artifact downloads require an http(s) task service URL');
  const target = new URL(value.url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Artifact download URL must use http(s)');
  if (target.origin !== configuredBase.origin) throw new Error('Artifact download URL must use the configured task service origin');
  if (!isAgentArtifactDownloadPath(target.pathname)) throw new Error('Artifact download URL must target a job artifact');
  const ownerToken = target.searchParams.get('ownerToken') || '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(ownerToken)) throw new Error('Artifact download URL must include a valid owner token');
  target.searchParams.delete('ownerToken');
  return { url: target, headers: { 'X-Owner-Token': ownerToken } };
}

export function resolveSafeAgentArtifactDownloadUrl(value: unknown, configuredRunnerUrl: string): URL {
  return resolveSafeAgentArtifactDownloadRequest(value, configuredRunnerUrl).url;
}

function isAgentArtifactDownloadPath(pathname: string): boolean {
  return /^\/api\/jobs\/[^/]+\/artifacts\/[^/]+$/.test(pathname);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
