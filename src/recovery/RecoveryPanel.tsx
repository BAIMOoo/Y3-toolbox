import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TimePoint } from '../types';
import { buildRecoveryExportBaseName, serializeRecoveryCsv, serializeRecoveryJson } from './recoveryExport';
import { inferRecoveryFragments, type RecoveryInferenceResult } from './recoveryInference';
import { RecoveryPreviewTree } from './RecoveryPreviewTree';

interface RecoveryPanelProps {
  fileName: string | null;
  aid?: string | null;
  aidConflict?: string[];
  timePoints: TimePoint[];
  selectedIndex: number;
  view?: 'entry' | 'workspace';
  onOpen?: () => void;
  onClose?: () => void;
}

type ExportFormat = 'csv' | 'json';

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
  onClose,
}) => {
  const selectedTimePoint = timePoints[selectedIndex] ?? timePoints[0] ?? null;
  const firstTimePoint = timePoints[0] ?? selectedTimePoint;
  const defaultTargetValue = firstTimePoint ? toDateTimeLocalValue(firstTimePoint.timestamp) : '';
  const selectedTargetValue = selectedTimePoint ? toDateTimeLocalValue(selectedTimePoint.timestamp) : defaultTargetValue;
  const hasAidConflict = aidConflict.length > 1;
  const [targetOverride, setTargetOverride] = useState<string | null>(null);
  const targetValue = targetOverride ?? defaultTargetValue;
  const [endEnabled, setEndEnabled] = useState(false);
  const [endValue, setEndValue] = useState('');

  const targetStartTime = useMemo(
    () => parseDateTimeLocalValue(targetValue) ?? firstTimePoint?.timestamp ?? new Date(),
    [firstTimePoint?.timestamp, targetValue],
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
  }, [aid, fileName, hasAidConflict, targetEndTime, targetStartTime, timePoints]);
  const [scheduledRecovery, setScheduledRecovery] = useState<{
    request: RecoveryInferenceRequest;
    result: RecoveryInferenceResult;
  } | null>(null);
  const recoveryRequestId = useRef(0);

  useEffect(() => {
    const requestId = recoveryRequestId.current + 1;
    recoveryRequestId.current = requestId;

    if (!recoveryRequest) return;

    const timeoutId = window.setTimeout(() => {
      const nextRecovery = inferRecoveryFragments({
        identity: { fileName: recoveryRequest.fileName, aid: recoveryRequest.aid },
        timePoints: recoveryRequest.timePoints,
        assumeSortedTimePoints: true,
        targetStartTime: recoveryRequest.targetStartTime,
        targetEndTime: recoveryRequest.targetEndTime,
      });

      if (recoveryRequestId.current !== requestId) return;
      setScheduledRecovery({ request: recoveryRequest, result: nextRecovery });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [recoveryRequest]);

  if (!fileName || timePoints.length === 0 || !selectedTimePoint) return null;

  const recovery = scheduledRecovery?.request === recoveryRequest ? scheduledRecovery.result : null;

  const baseName = buildRecoveryExportBaseName(fileName);

  const handleSeedFromSelected = () => {
    setTargetOverride(selectedTargetValue);
  };

  const handleExport = (format: ExportFormat) => {
    if (!recovery || hasAidConflict) return;
    if (format === 'csv') {
      downloadTextFile(`${baseName}_recovery.csv`, serializeRecoveryCsv(recovery), 'text/csv;charset=utf-8');
      return;
    }
    downloadTextFile(`${baseName}_recovery.json`, serializeRecoveryJson(recovery), 'application/json;charset=utf-8');
  };

  const provenCount = recovery?.fields.filter((field) => field.evidenceStatus === 'proven').length ?? 0;
  const insufficientCount = recovery?.fields.filter((field) => field.evidenceStatus === 'evidence-insufficient').length ?? 0;
  const isRecoveryLoading = recoveryRequest !== null && scheduledRecovery?.request !== recoveryRequest;
  const exportDisabled = hasAidConflict || isRecoveryLoading || !recovery || recovery.fields.length === 0;
  const previewFragments = recovery?.fragments ?? [];

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
      <div className="recovery-panel__summary">
        <div>
          <div className="recovery-panel__eyebrow">存档回退输入生成</div>
          <div className="recovery-panel__title">生成可审核的 CSV / JSON 恢复输入，不会写回存档</div>
          <div className="recovery-panel__meta">
            {hasAidConflict
              ? `检测到多个日志 aid（${aidConflict.join('、')}），V1 不支持混合玩家导出`
              : isRecoveryLoading
                ? `正在分析 ${fileName} 的回退字段，请稍候…`
                : `玩家标识：${recovery?.identity.playerLabel ?? fileName}（${recovery?.identity.playerIdentifierSource === 'aid-from-log' ? '日志 aid' : '文件名'}） · 已证明字段 ${provenCount} · 证据不足 ${insufficientCount}`}
          </div>
        </div>
        <div className="recovery-panel__actions">
          {onClose && <button type="button" className="recovery-panel__button" onClick={onClose}>返回变动对比</button>}
          <button type="button" className="recovery-panel__button" onClick={handleSeedFromSelected}>用当前时间</button>
          <button type="button" className="recovery-panel__button recovery-panel__button--primary" onClick={() => handleExport('csv')} disabled={exportDisabled}>导出 CSV</button>
          <button type="button" className="recovery-panel__button recovery-panel__button--primary" onClick={() => handleExport('json')} disabled={exportDisabled}>导出 JSON</button>
        </div>
      </div>

      <div className="recovery-panel__body">
          <div className="recovery-panel__controls">
            <label>
              <span>回退起点</span>
              <input type="datetime-local" step="1" value={targetValue} onChange={(event) => setTargetOverride(event.target.value)} />
            </label>
            <label className="recovery-panel__checkbox">
              <input type="checkbox" checked={endEnabled} onChange={(event) => setEndEnabled(event.target.checked)} />
              <span>启用结束时间</span>
            </label>
            <label>
              <span>结束时间</span>
              <input type="datetime-local" step="1" value={endValue} disabled={!endEnabled} onChange={(event) => setEndValue(event.target.value)} />
            </label>
          </div>

          <div className="recovery-panel__warning">
            {hasAidConflict
              ? '当前 CSV 包含多个玩家 aid。为避免把多个玩家的变动误标为同一玩家，V1 会阻止存档回退；请先导入单个玩家的日志。'
              : '默认从当前导入日志的最早时间开始扫描；点击“用当前时间”才会改用时间轴当前帧作为回退起点。V1 只输出日志能证明的字段；没有内置槽位 schema，不会凭空补全缺失字段。导出文件仅供后续工具/人工审核使用，本应用不写回任何存档。'}
          </div>

          {isRecoveryLoading && (
            <div className="recovery-panel__preview-summary" role="status" aria-live="polite">
              正在生成回退预览，完成前暂不可导出。
            </div>
          )}

          {!isRecoveryLoading && recovery && recovery.fields.length > 0 && (
            <div className="recovery-panel__preview-summary">
              当前预览展示全部 {recovery.fragments.length} 个槽位片段、{recovery.fields.length} 个字段；CSV / JSON 导出内容与预览一致。
            </div>
          )}

          <div className="recovery-panel__preview" aria-label="回退槽位片段预览">
            {isRecoveryLoading ? (
              <div className="recovery-panel__empty">正在生成回退预览…</div>
            ) : previewFragments.length === 0 ? (
              <div className="recovery-panel__empty">当前时间范围内没有可证明的回退字段。</div>
            ) : (
              <RecoveryPreviewTree fragments={previewFragments} />
            )}
          </div>
        </div>
    </section>
  );
};
