import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveSafeAgentArtifactDownloadRequest, resolveSafeAgentArtifactDownloadUrl } from '../../electron/agentArtifactDownload';

describe('Electron artifact download security contract', () => {
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const preloadSource = readFileSync(new URL('../../electron/preload.ts', import.meta.url), 'utf8');

  it('validates artifact download targets in main process before session downloadURL', () => {
    expect(source).toContain("ipcMain.handle('agent-artifact:download'");
    expect(source).toContain('resolveSafeAgentArtifactDownloadRequest(request, getConfiguredAgentRunnerUrl())');
    expect(source).toContain('event.sender.session.downloadURL(download.url.toString(), { headers: download.headers })');
  });

  it('accepts configured-runner artifact URLs and moves owner query into a download header', () => {
    const resolved = resolveSafeAgentArtifactDownloadRequest(
      { url: 'http://127.0.0.1:8790/api/jobs/job-1/artifacts/artifact-1?ownerToken=owner-token-0001' },
      'http://127.0.0.1:8790',
    );

    expect(resolved.url.toString()).toBe('http://127.0.0.1:8790/api/jobs/job-1/artifacts/artifact-1');
    expect(resolved.headers).toEqual({ 'X-Owner-Token': 'owner-token-0001' });
  });

  it('rejects artifact URLs without a valid owner token', () => {
    expect(() => resolveSafeAgentArtifactDownloadRequest(
      { url: 'http://127.0.0.1:8790/api/jobs/job-1/artifacts/artifact-1' },
      'http://127.0.0.1:8790',
    )).toThrow('valid owner token');
    expect(() => resolveSafeAgentArtifactDownloadRequest(
      { url: 'http://127.0.0.1:8790/api/jobs/job-1/artifacts/artifact-1?ownerToken=short' },
      'http://127.0.0.1:8790',
    )).toThrow('valid owner token');
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
    expect(source).toContain('event.sender.session.downloadURL');
    expect(source).not.toContain('downloadZipStream');
    expect(source).not.toContain('zipDownloadProgress');
  });

  it('emits desktop download progress events to the renderer', () => {
    expect(source).toContain("event.sender.send('agent-artifact:downloadProgress'");
    expect(source).toContain('dialog.showSaveDialog');
    expect(source).toContain('item.setSavePath(savePath)');
    expect(source).toContain("item.on('updated'");
    expect(source).toContain("item.once('done'");
    expect(preloadSource).toContain('onAgentArtifactDownloadProgress');
    expect(preloadSource).toContain("ipcRenderer.on('agent-artifact:downloadProgress'");
  });
});
