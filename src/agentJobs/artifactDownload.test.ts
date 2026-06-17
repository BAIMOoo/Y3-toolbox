import { describe, expect, it, vi } from 'vitest';
import { handleAgentArtifactDownloadClick } from './artifactDownload';

describe('agent artifact desktop download handoff', () => {
  it('prevents popup navigation and delegates to Electron when desktop bridge exists', async () => {
    const preventDefault = vi.fn();
    const downloadAgentArtifact = vi.fn().mockResolvedValue({ success: true });

    await expect(handleAgentArtifactDownloadClick(
      { preventDefault },
      'http://127.0.0.1:8790/api/jobs/job-1/artifacts/a.zip?ownerToken=owner-token-0001',
      'a.zip',
      { downloadAgentArtifact },
    )).resolves.toEqual({ handledByDesktop: true });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(downloadAgentArtifact).toHaveBeenCalledWith({ url: 'http://127.0.0.1:8790/api/jobs/job-1/artifacts/a.zip?ownerToken=owner-token-0001', filename: 'a.zip' });
  });

  it('leaves normal web navigation alone without desktop bridge', async () => {
    const preventDefault = vi.fn();

    await expect(handleAgentArtifactDownloadClick({ preventDefault }, '/api/jobs/job-1/artifacts/a.zip', 'a.zip', undefined))
      .resolves.toEqual({ handledByDesktop: false });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('surfaces desktop handoff failures', async () => {
    const preventDefault = vi.fn();
    const downloadAgentArtifact = vi.fn().mockResolvedValue({ success: false, error: 'bad artifact url' });

    await expect(handleAgentArtifactDownloadClick({ preventDefault }, 'https://evil.example/a.zip', 'a.zip', { downloadAgentArtifact }))
      .resolves.toEqual({ handledByDesktop: true, error: 'bad artifact url' });
  });
});
