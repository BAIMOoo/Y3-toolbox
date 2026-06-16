import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveSafeAgentArtifactDownloadUrl } from '../../electron/agentArtifactDownload';

describe('Electron artifact download security contract', () => {
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');

  it('validates artifact download targets in main process before downloadURL', () => {
    expect(source).toContain("ipcMain.handle('agent-artifact:download'");
    expect(source).toContain('resolveSafeAgentArtifactDownloadUrl(request, getConfiguredAgentRunnerUrl())');
    expect(source).toContain('downloadURL(url.toString())');
  });

  it('accepts configured-runner artifact URLs and preserves owner query', () => {
    const resolved = resolveSafeAgentArtifactDownloadUrl(
      { url: 'http://127.0.0.1:8790/api/jobs/job-1/artifacts/artifact-1?ownerToken=owner-token-0001' },
      'http://127.0.0.1:8790',
    );

    expect(resolved.toString()).toBe('http://127.0.0.1:8790/api/jobs/job-1/artifacts/artifact-1?ownerToken=owner-token-0001');
  });

  it('rejects external origins, non-http schemes, and non-artifact paths', () => {
    expect(() => resolveSafeAgentArtifactDownloadUrl(
      { url: 'http://evil.example/api/jobs/job-1/artifacts/a.zip' },
      'http://127.0.0.1:8790',
    )).toThrow('configured task service origin');
    expect(() => resolveSafeAgentArtifactDownloadUrl(
      { url: 'file:///tmp/a.zip' },
      'http://127.0.0.1:8790',
    )).toThrow('must use http(s)');
    expect(() => resolveSafeAgentArtifactDownloadUrl(
      { url: 'http://127.0.0.1:8790/api/jobs/job-1' },
      'http://127.0.0.1:8790',
    )).toThrow('must target a job artifact');
  });

  it('keeps artifact handoff separate from custom in-app zip streaming', () => {
    expect(source).toContain('event.sender.downloadURL');
    expect(source).not.toContain('downloadZipStream');
    expect(source).not.toContain('zipDownloadProgress');
  });
});
