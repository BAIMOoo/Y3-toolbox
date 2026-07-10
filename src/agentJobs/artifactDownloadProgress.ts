import type { AgentArtifactDownloadProgress } from '../types/electron';

export type AgentArtifactDownloadProgressByJob = Record<string, AgentArtifactDownloadProgress>;

export function getArtifactDownloadScopeKey(url: string, baseUrl = 'http://localhost'): string {
  try {
    const parsed = new URL(url, baseUrl);
    parsed.searchParams.delete('ownerToken');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function getVisibleArtifactDownloadProgress(
  activeJobId: string | undefined,
  progressByJob: AgentArtifactDownloadProgressByJob,
): AgentArtifactDownloadProgress | null {
  if (!activeJobId) return null;
  return progressByJob[activeJobId] ?? null;
}

export function isTerminalArtifactDownloadProgress(progress: AgentArtifactDownloadProgress): boolean {
  return progress.phase === 'complete' || progress.phase === 'cancelled' || progress.phase === 'failed';
}
