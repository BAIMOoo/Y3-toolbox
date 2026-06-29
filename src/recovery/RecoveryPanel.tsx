/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TimePoint } from '../types';
import { buildRecoveryExportBaseName, serializeRecoveryJson } from './recoveryExport';
import { inferRecoveryFragments, type RecoveryInferenceResult, type RecoverySlotFragment } from './recoveryInference';
import { RecoveryPreviewTree } from './RecoveryPreviewTree';

interface RecoveryPanelProps {
  fileName: string | null;
  aid?: string | null;
  aidConflict?: string[];
  timePoints: TimePoint[];
  selectedIndex: number;
  view?: 'entry' | 'workspace';
  onOpen?: () => void;
}


const RECOVERY_PREVIEW_INITIAL_FIELD_BUDGET = 500;
const RECOVERY_PREVIEW_FIELD_BUDGET_INCREMENT = 500;
const RECOVERY_PANEL_CACHE_ENTRIES_PER_DATASET = 8;

interface PanelRecoveryCacheBucket {
  entries: Map<string, RecoveryInferenceResult>;
}

let panelRecoveryCache = new WeakMap<TimePoint[], PanelRecoveryCacheBucket>();

export function clearRecoveryPanelCacheForTests(): void {
  panelRecoveryCache = new WeakMap<TimePoint[], PanelRecoveryCacheBucket>();
}

function normalizeAid(aid: string | null | undefined): string {
  return typeof aid === 'string' ? aid.trim() : '';
}

function recoveryRequestCacheKey(request: RecoveryInferenceRequest): string {
  return JSON.stringify({
    fileName: request.fileName,
    aid: normalizeAid(request.aid),
    targetStartTime: request.targetStartTime.toISOString(),
    targetEndTime: request.targetEndTime ? request.targetEndTime.toISOString() : null,
  });
}

function getPanelCachedRecovery(request: RecoveryInferenceRequest): RecoveryInferenceResult | null {
  return panelRecoveryCache.get(request.timePoints)?.entries.get(recoveryRequestCacheKey(request)) ?? null;
}

function setPanelCachedRecovery(request: RecoveryInferenceRequest, result: RecoveryInferenceResult): void {
  let bucket = panelRecoveryCache.get(request.timePoints);
  if (!bucket) {
    bucket = { entries: new Map() };
    panelRecoveryCache.set(request.timePoints, bucket);
  }
  const key = recoveryRequestCacheKey(request);
  if (bucket.entries.has(key)) bucket.entries.delete(key);
  bucket.entries.set(key, result);
  while (bucket.entries.size > RECOVERY_PANEL_CACHE_ENTRIES_PER_DATASET) {
    const oldestKey = bucket.entries.keys().next().value;
    if (oldestKey === undefined) break;
    bucket.entries.delete(oldestKey);
  }
}

function inferPanelRecovery(request: RecoveryInferenceRequest): RecoveryInferenceResult {
  const cached = getPanelCachedRecovery(request);
  if (cached) return cached;

  // This cache is deliberately private to RecoveryPanel's exact request shape.
  // Do not move it into recoveryInference.ts or reuse it for generic calls with
  // expectedFields, explicit generatedAt, or different assumeSortedTimePoints semantics.
  const result = inferRecoveryFragments({
    identity: { fileName: request.fileName, aid: request.aid },
    timePoints: request.timePoints,
    assumeSortedTimePoints: true,
    targetStartTime: request.targetStartTime,
    targetEndTime: request.targetEndTime,
  });
  setPanelCachedRecovery(request, result);
  return result;
}

interface VisibleRecoveryPreview {
  fragments: RecoverySlotFragment[];
  visibleFieldCount: number;
  hiddenFieldCount: number;
  visibleFragmentCount: number;
}

function buildVisibleRecoveryPreview(recovery: RecoveryInferenceResult | null, fieldBudget: number): VisibleRecoveryPreview {
  if (!recovery || fieldBudget <= 0) {
    return { fragments: [], visibleFieldCount: 0, hiddenFieldCount: recovery?.fields.length ?? 0, visibleFragmentCount: 0 };
  }

  const visibleFragments: RecoverySlotFragment[] = [];
  let remaining = fieldBudget;
  let visibleFieldCount = 0;

  for (const fragment of recovery.fragments) {
    if (remaining <= 0) break;
    const visibleFields = fragment.fields.slice(0, remaining);
    if (visibleFields.length === 0) continue;
    visibleFragments.push({ ...fragment, fields: visibleFields });
    visibleFieldCount += visibleFields.length;
    remaining -= visibleFields.length;
  }

  return {
    fragments: visibleFragments,
    visibleFieldCount,
    hiddenFieldCount: Math.max(0, recovery.fields.length - visibleFieldCount),
    visibleFragmentCount: visibleFragments.length,
  };
}

interface RecoveryInferenceRequest {
  fileName: string;
  aid?: string | null;
  timePoints: TimePoint[];
  targetStartTime: Date;
  targetEndTime: Date | null;
}
function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseDateTimeLocalValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function downloadTextFile(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const RecoveryPanel: React.FC<RecoveryPanelProps> = ({
  fileName,
  aid,
  aidConflict = [],
  timePoints,
  selectedIndex,
  view = 'workspace',
  onOpen,
}) => {
  const selectedTimePoint = timePoints[selectedIndex] ?? timePoints[0] ?? null;
  const firstTimePoint = timePoints[0] ?? selectedTimePoint;
  const firstTimestamp = firstTimePoint?.timestamp;
  const defaultTargetValue = firstTimestamp ? toDateTimeLocalValue(firstTimestamp) : '';
  const selectedTargetValue = selectedTimePoint ? toDateTimeLocalValue(selectedTimePoint.timestamp) : defaultTargetValue;
  const hasAidConflict = aidConflict.length > 1;
  const [targetOverride, setTargetOverride] = useState<string | null>(null);
  const targetValue = targetOverride ?? defaultTargetValue;
  const [endEnabled, setEndEnabled] = useState(false);
  const [endValue, setEndValue] = useState('');

  const targetStartTime = useMemo(
    () => parseDateTimeLocalValue(targetValue) ?? firstTimestamp ?? new Date(),
    [firstTimestamp, targetValue],
  );
  const targetEndTime = useMemo(
    () => (endEnabled ? parseDateTimeLocalValue(endValue) : null),
    [endEnabled, endValue],
  );
  const recoveryRequest = useMemo<RecoveryInferenceRequest | null>(() => {
    if (!fileName || timePoints.length === 0 || !firstTimePoint || hasAidConflict) return null;
    return {
      fileName,
      aid,
      timePoints,
      targetStartTime,
      targetEndTime,
    };
  }, [aid, fileName, firstTimePoint, hasAidConflict, targetEndTime, targetStartTime, timePoints]);
  const recoveryRequestKey = recoveryRequest ? recoveryRequestCacheKey(recoveryRequest) : null;
  const cachedRecovery = recoveryRequest ? getPanelCachedRecovery(recoveryRequest) : null;
  const [scheduledRecovery, setScheduledRecovery] = useState<{
    request: RecoveryInferenceRequest;
    requestKey: string;
    result: RecoveryInferenceResult;
  } | null>(() => (recoveryRequest && cachedRecovery && recoveryRequestKey
    ? { request: recoveryRequest, requestKey: recoveryRequestKey, result: cachedRecovery }
    : null));
  const [previewBudgetState, setPreviewBudgetState] = useState<{ requestKey: string | null; fieldBudget: number }>({
    requestKey: recoveryRequestKey,
    fieldBudget: RECOVERY_PREVIEW_INITIAL_FIELD_BUDGET,
  });
  const recoveryRequestId = useRef(0);

  useEffect(() => {
    const requestId = recoveryRequestId.current + 1;
    recoveryRequestId.current = requestId;

    if (!recoveryRequest || !recoveryRequestKey) return;

    if (getPanelCachedRecovery(recoveryRequest)) return;

    const timeoutId = window.setTimeout(() => {
      const nextRecovery = inferPanelRecovery(recoveryRequest);

      if (recoveryRequestId.current !== requestId) return;
      setScheduledRecovery({ request: recoveryRequest, requestKey: recoveryRequestKey, result: nextRecovery });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [recoveryRequest, recoveryRequestKey]);

  const recovery = cachedRecovery ?? (scheduledRecovery?.request === recoveryRequest ? scheduledRecovery.result : null);

  const baseName = buildRecoveryExportBaseName(fileName ?? '');

  const handleSeedFromSelected = () => {
    setTargetOverride(selectedTargetValue);
  };

  const handleExportJson = () => {
    if (!recovery || hasAidConflict) return;
    downloadTextFile(`${baseName}_recovery.json`, serializeRecoveryJson(recovery), 'application/json;charset=utf-8');
  };

  const isRecoveryLoading = recoveryRequest !== null && !recovery;
  const exportDisabled = hasAidConflict || isRecoveryLoading || !recovery || recovery.fields.length === 0;
  const previewFieldBudget = previewBudgetState.requestKey === recoveryRequestKey
    ? previewBudgetState.fieldBudget
    : RECOVERY_PREVIEW_INITIAL_FIELD_BUDGET;
  const visiblePreview = useMemo(
    () => buildVisibleRecoveryPreview(recovery, previewFieldBudget),
    [previewFieldBudget, recovery],
  );
  const previewFragments = visiblePreview.fragments;
  const canShowMorePreview = Boolean(recovery && visiblePreview.hiddenFieldCount > 0);
  const previewSummary = recovery && recovery.fields.length > 0
    ? `当前预览展示 ${visiblePreview.visibleFragmentCount} / ${recovery.fragments.length} 个槽位片段、${visiblePreview.visibleFieldCount} / ${recovery.fields.length} 个字段；JSON 导出包含全部字段。`
    : null;

  const handleShowMorePreview = () => {
    setPreviewBudgetState({
      requestKey: recoveryRequestKey,
      fieldBudget: previewFieldBudget + RECOVERY_PREVIEW_FIELD_BUDGET_INCREMENT,
    });
  };

  if (!fileName || timePoints.length === 0 || !selectedTimePoint) return null;

  if (view === 'entry') {
    return (
      <div className="recovery-entry" aria-label="存档回退入口">
        <button type="button" className="recovery-entry__button" onClick={onOpen}>
          存档回退
        </button>
      </div>
    );
  }

  return (
    <section className="recovery-panel recovery-panel--workspace" aria-label="存档回退输入生成">
      <div className="recovery-panel__toolbar">
        <div className="recovery-panel__summary recovery-panel__summary--compact">
          <div className="recovery-panel__heading">
            <div className="recovery-panel__title-row">
              <div className="recovery-panel__title">存档回退</div>
              <div className="recovery-panel__warning recovery-panel__warning--title">不写回存档；V1 只输出日志能证明的字段；不补全 schema；导出供后续工具/人工审核。</div>
            </div>
            <div className="recovery-panel__meta" aria-live="polite">
              {hasAidConflict
                ? `检测到多个日志 aid（${aidConflict.join('、')}），V1 不支持混合玩家导出`
                : isRecoveryLoading
                  ? `正在分析 ${fileName} 的回退字段，请稍候…`
                  : previewSummary}
            </div>
          </div>
          <div className="recovery-panel__actions">
            <button type="button" className="recovery-panel__button recovery-panel__button--primary" onClick={handleExportJson} disabled={exportDisabled}>导出 JSON</button>
          </div>
        </div>

        <div className="recovery-panel__controls recovery-panel__controls--compact">
            <label>
              <span>回退起点</span>
              <input type="datetime-local" step="1" value={targetValue} onChange={(event) => setTargetOverride(event.target.value)} />
            </label>
            <button type="button" className="recovery-panel__button recovery-panel__button--time-axis" onClick={handleSeedFromSelected}>用时间轴所处时间</button>
            <label className="recovery-panel__checkbox">
              <input type="checkbox" checked={endEnabled} onChange={(event) => setEndEnabled(event.target.checked)} />
              <span>启用结束时间</span>
            </label>
            <label>
              <span>结束时间</span>
              <input type="datetime-local" step="1" value={endValue} disabled={!endEnabled} onChange={(event) => setEndValue(event.target.value)} />
            </label>
            {isRecoveryLoading && (
              <div className="recovery-panel__preview-summary recovery-panel__preview-summary--inline" role="status" aria-live="polite">
                正在生成回退预览，完成前暂不可导出。
              </div>
            )}
          </div>
      </div>

      <div className="recovery-panel__body">
          <div className="recovery-panel__preview" aria-label="回退槽位片段预览">
            {isRecoveryLoading ? (
              <div className="recovery-panel__empty">正在生成回退预览…</div>
            ) : previewFragments.length === 0 ? (
              <div className="recovery-panel__empty">当前时间范围内没有可证明的回退字段。</div>
            ) : (
              <>
                <RecoveryPreviewTree fragments={previewFragments} />
                {canShowMorePreview && (
                  <button type="button" className="recovery-panel__button" onClick={handleShowMorePreview}>
                    显示更多回退字段（再显示 {Math.min(RECOVERY_PREVIEW_FIELD_BUDGET_INCREMENT, visiblePreview.hiddenFieldCount)} 个，剩余 {visiblePreview.hiddenFieldCount} 个）
                  </button>
                )}
              </>
            )}
          </div>
        </div>
    </section>
  );
};
