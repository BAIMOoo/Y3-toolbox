import type { KkresImageStageProgress } from '../types/electron';

export interface StageProgressState extends KkresImageStageProgress {
  percent: number;
}

export function createKkresStageRequestId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `kkres-stage-${Date.now()}-${random}`;
}

export function toStageProgressState(progress: KkresImageStageProgress): StageProgressState {
  const totalBytes = Math.max(0, progress.totalBytes);
  const uploadedBytes = Math.max(0, progress.uploadedBytes);
  const percent = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
  return { ...progress, percent };
}

export function shouldAcceptStageProgress(activeRequestId: string | null, progress: KkresImageStageProgress): boolean {
  return Boolean(activeRequestId) && progress.requestId === activeRequestId;
}


export interface StageProgressSource {
  onKkresImageStageProgress?: (callback: (progress: KkresImageStageProgress) => void) => () => void;
}

export function subscribeToActiveStageProgress(
  source: StageProgressSource | undefined,
  getActiveRequestId: () => string | null,
  onProgress: (progress: StageProgressState) => void,
): () => void {
  return source?.onKkresImageStageProgress?.((progress) => {
    if (!shouldAcceptStageProgress(getActiveRequestId(), progress)) return;
    onProgress(toStageProgressState(progress));
  }) ?? (() => undefined);
}
