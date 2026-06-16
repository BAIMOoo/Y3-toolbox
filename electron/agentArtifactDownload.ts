export function resolveSafeAgentArtifactDownloadUrl(value: unknown, configuredRunnerUrl: string): URL {
  if (!isPlainObject(value) || typeof value.url !== 'string') throw new Error('Invalid artifact download request');
  const configuredBase = new URL(configuredRunnerUrl);
  if (!['http:', 'https:'].includes(configuredBase.protocol)) throw new Error('Artifact downloads require an http(s) task service URL');
  const target = new URL(value.url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Artifact download URL must use http(s)');
  if (target.origin !== configuredBase.origin) throw new Error('Artifact download URL must use the configured task service origin');
  if (!isAgentArtifactDownloadPath(target.pathname)) throw new Error('Artifact download URL must target a job artifact');
  return target;
}

function isAgentArtifactDownloadPath(pathname: string): boolean {
  return /^\/api\/jobs\/[^/]+\/artifacts\/[^/]+$/.test(pathname);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
