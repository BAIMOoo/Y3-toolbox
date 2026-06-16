import { describe, expect, it, vi } from 'vitest';
import { shouldAcceptStageProgress, subscribeToActiveStageProgress, toStageProgressState } from './stageProgress';
import type { KkresImageStageProgress } from '../types/electron';

const progress: KkresImageStageProgress = {
  requestId: 'request-a',
  phase: 'uploading',
  currentFileIndex: 1,
  totalFiles: 2,
  uploadedBytes: 50,
  totalBytes: 200,
  message: 'uploading',
};

describe('kkres stage progress helpers', () => {
  it('accepts only the active request id', () => {
    expect(shouldAcceptStageProgress('request-a', progress)).toBe(true);
    expect(shouldAcceptStageProgress('request-b', progress)).toBe(false);
    expect(shouldAcceptStageProgress(null, progress)).toBe(false);
  });

  it('derives a bounded percentage from byte totals', () => {
    expect(toStageProgressState(progress).percent).toBe(25);
    expect(toStageProgressState({ ...progress, uploadedBytes: 999 }).percent).toBe(100);
    expect(toStageProgressState({ ...progress, totalBytes: 0 }).percent).toBe(0);
  });

  it('unsubscribes the real progress subscription and ignores stale request events', () => {
    const unsubscribe = vi.fn();
    let callback: ((value: KkresImageStageProgress) => void) | undefined;
    const onProgress = vi.fn();
    const cleanup = subscribeToActiveStageProgress(
      { onKkresImageStageProgress: (registered) => { callback = registered; return unsubscribe; } },
      () => 'request-a',
      onProgress,
    );

    callback?.({ ...progress, requestId: 'stale-request', uploadedBytes: 100 });
    expect(onProgress).not.toHaveBeenCalled();

    callback?.(progress);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-a', percent: 25 }));

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
