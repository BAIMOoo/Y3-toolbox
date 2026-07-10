import { describe, expect, it } from 'vitest';
import { getArtifactDownloadScopeKey, getVisibleArtifactDownloadProgress, isTerminalArtifactDownloadProgress } from './artifactDownloadProgress';
import type { AgentArtifactDownloadProgress } from '../types/electron';

const progress: AgentArtifactDownloadProgress = {
  id: 'download-1',
  url: 'http://127.0.0.1:8791/api/jobs/job-a/artifacts/a.zip',
  filename: 'a.zip',
  receivedBytes: 10,
  totalBytes: 100,
  phase: 'progress',
  message: '正在下载…',
};

describe('agent artifact download progress scoping', () => {
  it('uses the same scope key before and after Electron moves owner token into a header', () => {
    expect(getArtifactDownloadScopeKey('http://127.0.0.1:8791/api/jobs/job-a/artifacts/a.zip?ownerToken=owner-token-0001'))
      .toBe('http://127.0.0.1:8791/api/jobs/job-a/artifacts/a.zip');
    expect(getArtifactDownloadScopeKey('http://127.0.0.1:8791/api/jobs/job-a/artifacts/a.zip'))
      .toBe('http://127.0.0.1:8791/api/jobs/job-a/artifacts/a.zip');
  });

  it('shows progress only for the currently selected task', () => {
    const progressByJob = { 'job-a': progress };

    expect(getVisibleArtifactDownloadProgress('job-a', progressByJob)).toBe(progress);
    expect(getVisibleArtifactDownloadProgress('job-b', progressByJob)).toBeNull();
  });

  it('keeps each task download progress independent when multiple downloads report events', () => {
    const jobBProgress = { ...progress, id: 'download-2', filename: 'b.zip' };
    const progressByJob = { 'job-a': progress, 'job-b': jobBProgress };

    expect(getVisibleArtifactDownloadProgress('job-a', progressByJob)).toBe(progress);
    expect(getVisibleArtifactDownloadProgress('job-b', progressByJob)).toBe(jobBProgress);
  });

  it('recognizes completed, cancelled, and failed downloads as terminal', () => {
    expect(isTerminalArtifactDownloadProgress({ ...progress, phase: 'progress' })).toBe(false);
    expect(isTerminalArtifactDownloadProgress({ ...progress, phase: 'complete' })).toBe(true);
    expect(isTerminalArtifactDownloadProgress({ ...progress, phase: 'cancelled' })).toBe(true);
    expect(isTerminalArtifactDownloadProgress({ ...progress, phase: 'failed' })).toBe(true);
  });
});
