import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { DownloadOutlined } from '@ant-design/icons';
import { Button, Alert, Card, Input, InputNumber, Progress, Select, Space, Tag, Typography, message } from 'antd';
import { fetchAgentHealth, getAgentArtifactDownloadUrl, fetchAgentJob, fetchAgentJobEvents, fetchAgentJobs, fetchAgentSkills, getAgentOwnerToken, submitAgentJob } from './api';
import { evaluateAgentCompatibility } from './agentCompatibility';
import { applyAgentParamDefaults, getAgentParamDefaults, validateAgentParams } from './catalog';
import type { AgentHealthResponse, AgentJobEvent, AgentJobEventsResponse, AgentJobSummary, AgentSkillDefinition, AgentSubmitRequest } from './types';
import { AgentJobEventList } from './AgentJobEventList';
import { filterUserVisibleJobEvents } from './eventVisibility';
import { getAgentQueueStatus, getAgentRunnerStatus, hasActiveAgentJobs, isTerminalAgentJob, refreshActiveAgentJobs } from './agentJobCenterStatus';
import { handleAgentArtifactDownloadClick } from './artifactDownload';
import { getArtifactDownloadScopeKey, getVisibleArtifactDownloadProgress, isTerminalArtifactDownloadProgress, type AgentArtifactDownloadProgressByJob } from './artifactDownloadProgress';
import { formatArtifactSize } from './formatArtifactSize';
import { formatAgentJobListTime } from './formatAgentJobListTime';
import { summarizeReadableMessage } from './readableMessage';
import { createKkresStageRequestId, subscribeToActiveStageProgress, type StageProgressState } from './stageProgress';
import type { AgentArtifactDownloadProgress } from '../types/electron';

const KKRES_IMPORT_SAFETY_TITLE = '导入前安全提醒';
const KKRES_IMPORT_SAFETY_DESCRIPTION = '不要直接把生成的 KKRes 导入正式项目；请先导入测试项目确认资源管理器和 UI 编辑器显示正常，导入正式项目前请先做好项目备份。';
const PARTIAL_ARCHIVE_ARTIFACT_WARNING_TITLE = '任务失败，但有部分下载包';
const PARTIAL_ARCHIVE_ARTIFACT_WARNING_DESCRIPTION = '这个 ZIP 只包含失败前已安全写出的部分归档变更证据，内容可能不完整；任务仍为失败状态，请按失败日志重试或排查。';

export function AgentJobCenter() {
  const [skills, setSkills] = useState<AgentSkillDefinition[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('fetch-archive-changes');
  const [formValues, setFormValues] = useState<Record<string, string | number>>({});
  const [jobs, setJobs] = useState<AgentJobSummary[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobEvents, setJobEvents] = useState<Record<string, AgentJobEvent[]>>({});
  const [jobEventMeta, setJobEventMeta] = useState<Record<string, Pick<AgentJobEventsResponse, 'latestEventId' | 'truncatedBefore'>>>({});
  const [health, setHealth] = useState<AgentHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [stageProgress, setStageProgress] = useState<StageProgressState | null>(null);
  const [artifactDownloadProgressByJob, setArtifactDownloadProgressByJob] = useState<AgentArtifactDownloadProgressByJob>({});
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const latestEventIdsRef = useRef<Record<string, number>>({});
  const activeStageRequestIdRef = useRef<string | null>(null);
  const artifactDownloadJobByUrlRef = useRef<Record<string, string>>({});

  const selectedSkill = useMemo(() => skills.find((skill) => skill.id === selectedSkillId) ?? skills[0], [selectedSkillId, skills]);
  const effectiveFormValues = useMemo(() => (selectedSkill ? applyAgentParamDefaults(selectedSkill.id, formValues) : formValues), [selectedSkill, formValues]);
  const activeJob = useMemo(() => jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null, [activeJobId, jobs]);
  const activeJobStableId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  const activeJobEvents = useMemo(() => (activeJob ? jobEvents[activeJob.id] ?? [] : []), [activeJob, jobEvents]);
  const visibleActiveJobEvents = useMemo(() => filterUserVisibleJobEvents(activeJobEvents), [activeJobEvents]);
  const activeJobEventMeta = activeJob ? jobEventMeta[activeJob.id] : undefined;
  const activeJobDownloadArtifacts = useMemo(() => (activeJob ? visibleDownloadArtifacts(activeJob) : []), [activeJob]);
  const visibleArtifactDownloadProgress = useMemo(
    () => getVisibleArtifactDownloadProgress(activeJobStableId, artifactDownloadProgressByJob),
    [activeJobStableId, artifactDownloadProgressByJob],
  );
  const showPartialArchiveArtifactWarning = activeJob?.skillId === 'fetch-archive-changes'
    && activeJob.status === 'failed'
    && activeJobDownloadArtifacts.length > 0;
  const compatibility = useMemo(() => evaluateAgentCompatibility(health?.release), [health]);
  const maintenanceSubmitBlocked = Boolean(health?.queue.submissionsDisabled);
  const showCompatibilityAlert = !bootstrapLoading && compatibility.submitBlocked;
  const submitDisabledReason = bootstrapLoading
    ? '正在连接任务服务'
    : maintenanceSubmitBlocked
      ? '任务服务维护中，暂不接受新任务'
      : compatibility.submitBlocked
        ? compatibility.message ?? compatibility.statusLabel
        : '';
  const serviceStatus = useMemo(() => getAgentRunnerStatus(health, { loading: bootstrapLoading, compatibility }), [bootstrapLoading, compatibility, health]);
  const queueStatus = useMemo(() => getAgentQueueStatus(health, { loading: bootstrapLoading }), [bootstrapLoading, health]);
  const refreshHealth = useCallback(async () => {
    const healthPayload = await fetchAgentHealth();
    setHealth(healthPayload);
    return healthPayload;
  }, []);

  const refresh = useCallback(async () => {
    const [skillPayload, healthPayload, jobPayload] = await Promise.all([fetchAgentSkills(), fetchAgentHealth(), fetchAgentJobs()]);
    setSkills(skillPayload.skills);
    setHealth(healthPayload);
    setJobs(jobPayload.jobs);
  }, []);

  useEffect(() => {
    setBootstrapLoading(true);
    void refresh()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBootstrapLoading(false));
  }, [refresh]);


  useEffect(() => {
    if (!selectedSkill) return;
    setFormValues((current) => ({ ...getAgentParamDefaults(selectedSkill.id), ...current }));
  }, [selectedSkill]);

  useEffect(() => {
    if (!hasActiveAgentJobs(jobs)) return;
    const timer = window.setInterval(() => {
      void refreshActiveAgentJobs(
        jobs,
        (jobId) => fetchAgentJob(jobId).then((payload) => payload.job),
      )
        .then(setJobs)
        .then(() => refreshHealth().catch(() => undefined))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [jobs, refreshHealth]);

  const mergeJobEvents = useCallback((jobId: string, payload: AgentJobEventsResponse) => {
    latestEventIdsRef.current[jobId] = payload.latestEventId;
    setJobEvents((current) => {
      const truncatedBefore = payload.truncatedBefore;
      const retainedCurrent = truncatedBefore === undefined
        ? current[jobId] ?? []
        : (current[jobId] ?? []).filter((event) => event.id >= truncatedBefore);
      const byId = new Map<number, AgentJobEvent>();
      for (const event of retainedCurrent) byId.set(event.id, event);
      for (const event of payload.events) byId.set(event.id, event);
      return { ...current, [jobId]: Array.from(byId.values()).sort((a, b) => a.id - b.id) };
    });
    setJobEventMeta((current) => ({
      ...current,
      [jobId]: { latestEventId: payload.latestEventId, truncatedBefore: payload.truncatedBefore },
    }));
  }, []);

  const loadJobEvents = useCallback(async (jobId: string, after?: number) => {
    const payload = await fetchAgentJobEvents(jobId, after);
    mergeJobEvents(jobId, payload);
    return payload.latestEventId;
  }, [mergeJobEvents]);

  useEffect(() => {
    if (!activeJobStableId) return;
    let cancelled = false;
    const jobId = activeJobStableId;
    const pollEvents = async () => {
      try {
        await loadJobEvents(jobId, latestEventIdsRef.current[jobId]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void pollEvents();
    if (activeJobStatus && isTerminalAgentJob({ status: activeJobStatus })) {
      return () => { cancelled = true; };
    }
    const timer = window.setInterval(() => void pollEvents(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobStableId, activeJobStatus, loadJobEvents]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [activeJobStableId, visibleActiveJobEvents.length]);
  useEffect(() => subscribeToActiveStageProgress(
    window.electronAPI,
    () => activeStageRequestIdRef.current,
    setStageProgress,
  ), []);
  useEffect(() => window.electronAPI?.onAgentArtifactDownloadProgress?.((progress) => {
    const scopeKey = getArtifactDownloadScopeKey(progress.url, window.location.href);
    const jobId = artifactDownloadJobByUrlRef.current[scopeKey];
    if (!jobId) return;
    setArtifactDownloadProgressByJob((current) => ({ ...current, [jobId]: progress }));
    if (isTerminalArtifactDownloadProgress(progress)) delete artifactDownloadJobByUrlRef.current[scopeKey];
  }) ?? (() => undefined), []);

  const handleArtifactDownload = async (event: MouseEvent<HTMLElement>, jobId: string, artifactUrl: string, artifactName?: string) => {
    const scopeKey = getArtifactDownloadScopeKey(artifactUrl, window.location.href);
    artifactDownloadJobByUrlRef.current[scopeKey] = jobId;
    const pendingProgress: AgentArtifactDownloadProgress = {
      id: `pending-${Date.now()}`,
      url: artifactUrl,
      filename: artifactName || artifactUrl.split('/').pop()?.split('?')[0] || 'artifact',
      receivedBytes: 0,
      totalBytes: 0,
      phase: 'started',
      message: '正在打开保存位置选择…',
    };
    setArtifactDownloadProgressByJob((current) => ({ ...current, [jobId]: pendingProgress }));
    const result = await handleAgentArtifactDownloadClick(event, artifactUrl, artifactName, window.electronAPI);
    if (result.error) {
      delete artifactDownloadJobByUrlRef.current[scopeKey];
      setError(result.error);
      setArtifactDownloadProgressByJob((current) => current[jobId] ? {
        ...current,
        [jobId]: { ...current[jobId], phase: 'failed', message: result.error ?? '下载失败' },
      } : current);
      message.error(result.error);
      return;
    }
    if (result.handledByDesktop) message.success('已交给系统下载管理器处理。');
  };


  const updateField = (name: string, value: string | number | null) => {
    setFormValues((current) => ({ ...current, [name]: value ?? '' }));
  };

  const appendImagePaths = (paths: string[]) => {
    const normalized = normalizeKkresImagePaths(paths);
    if (normalized.length === 0) return;
    setFormValues((current) => ({
      ...current,
      images: mergeLineValues(String(current.images ?? ''), normalized),
    }));
  };

  const openKkresImageDirectory = async () => {
    const dirPath = await window.electronAPI?.openKkresImageDirectoryDialog?.();
    if (dirPath) appendImagePaths([dirPath]);
  };

  const openKkresImageFiles = async () => {
    const filePaths = await window.electronAPI?.openKkresImageFilesDialog?.();
    appendImagePaths(filePaths ?? []);
  };

  const submit = async () => {
    if (!selectedSkill) return;
    if (maintenanceSubmitBlocked) {
      setError('任务服务维护中，暂不接受新任务');
      return;
    }
    if (compatibility.submitBlocked) {
      setError(compatibility.message ?? compatibility.statusLabel);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const stageRequestId = createKkresStageRequestId();
      const params = await prepareAgentSubmitParams(
        selectedSkill.id,
        applyAgentParamDefaults(selectedSkill.id, formValues) as AgentSubmitRequest['params'],
        (images) => setFormValues((current) => ({ ...current, images })),
        stageRequestId,
        (requestId) => {
          activeStageRequestIdRef.current = requestId;
          setStageProgress({ requestId, phase: 'collecting', currentFileIndex: 0, totalFiles: 0, uploadedBytes: 0, totalBytes: 0, message: '正在准备上传图片…', percent: 0 });
        },
      );
      const validationErrors = validateAgentParams(selectedSkill.id, params);
      if (validationErrors.length > 0) {
        setError(validationErrors.join('；'));
        return;
      }
      const payload = await submitAgentJob({ skillId: selectedSkill.id, params });
      setJobs((current) => [payload.job, ...current.filter((job) => job.id !== payload.job.id)]);
      setActiveJobId(payload.job.id);
      void refreshHealth().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (activeStageRequestIdRef.current) {
        setStageProgress((current) => current ? { ...current, phase: 'failed', message: err instanceof Error ? err.message : String(err) } : current);
      }
    } finally {
      activeStageRequestIdRef.current = null;
      setLoading(false);
    }
  };

  return (
    <section className="agent-job-center" aria-label="Agent 任务中心">
      <div className="agent-job-topbar">
        <div className="agent-job-topbar__title">
          <p className="eyebrow">任务服务</p>
          <h1>Agent 任务中心</h1>
          <p>选择任务、提交参数，并在这里查看实时进度与下载结果。</p>
        </div>
        <div className="agent-job-topbar__status" aria-label="任务服务和队列状态">
          {bootstrapLoading && <span className="inline-loading-spinner" aria-label="正在连接任务服务" />}
          <Tag color={serviceStatus.color}>{serviceStatus.label}</Tag>
          <Tag color={queueStatus.color} title={queueStatus.title}>{queueStatus.label}</Tag>
        </div>
      </div>

      <Alert
        className="agent-job-beta-alert"
        type="warning"
        showIcon
        message="共享任务服务：真实任务会执行"
        description={`提交后会触发真实任务；任务按当前浏览器本地标识区分（${getAgentOwnerToken().slice(0, 8)}…），服务可能随时限流、排队、维护或暂停提交。`}
      />
      {showCompatibilityAlert && (
        <Alert
          className="agent-job-compatibility-alert"
          type="error"
          showIcon
          message={compatibility.message}
          description={(
            <Space direction="vertical" size={4}>
              <span>{compatibility.description}</span>
              <span>已有任务列表和结果仍可查看；只有新任务提交会被暂停。</span>
              <span>当前客户端：{compatibility.currentClientVersion}{compatibility.minimumClientVersion ? ` · 最低要求：${compatibility.minimumClientVersion}` : ''}{compatibility.supportedClientRange ? ` · 支持范围：${compatibility.supportedClientRange}` : ''}</span>
              <a href={compatibility.latestClientUrl} target="_blank" rel="noreferrer">打开 GitHub Releases 下载最新版本</a>
            </Space>
          )}
        />
      )}
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError(null)} />}

      <div className="agent-job-workspace">
        <Card title="提交任务" className="agent-job-card agent-job-submit-card">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {bootstrapLoading ? (
              <AgentJobLoadingState message="正在加载任务能力…" />
            ) : (
              <Select
                className="agent-skill-select"
                popupClassName="agent-skill-select-popup"
                popupMatchSelectWidth={320}
                style={{ width: '100%' }}
                value={selectedSkill?.id}
                onChange={(value) => {
                  setSelectedSkillId(value);
                  setFormValues(getAgentParamDefaults(value));
                }}
                options={skills.map((skill) => ({ value: skill.id, label: skill.label }))}
              />
            )}
            {selectedSkill && !bootstrapLoading && <Typography.Paragraph type="secondary">{selectedSkill.description}</Typography.Paragraph>}
            {selectedSkill?.fields.map((field) => {
              if (selectedSkill.id === 'export-kkres-image' && field.name === 'images') {
                return (
                  <KkresImagePathField
                    key={field.name}
                    label={field.label}
                    required={field.required}
                    value={String(effectiveFormValues[field.name] ?? '')}
                    placeholder={field.placeholder}
                    description={field.description}
                    canUseNativePicker={Boolean(window.electronAPI?.openKkresImageDirectoryDialog || window.electronAPI?.openKkresImageFilesDialog)}
                    onChange={(value) => updateField(field.name, value)}
                    onAppendPaths={appendImagePaths}
                    onOpenDirectory={() => void openKkresImageDirectory()}
                    onOpenFiles={() => void openKkresImageFiles()}
                  />
                );
              }
              return (
                <label key={field.name} className="agent-job-field">
                  <span>{field.label}{field.required ? ' *' : ''}</span>
                  {field.type === 'textarea' ? (
                    <Input.TextArea rows={4} value={String(effectiveFormValues[field.name] ?? '')} placeholder={field.placeholder} onChange={(event) => updateField(field.name, event.target.value)} />
                  ) : field.type === 'number' ? (
                    <InputNumber style={{ width: '100%' }} value={effectiveFormValues[field.name] === undefined || effectiveFormValues[field.name] === '' ? null : Number(effectiveFormValues[field.name])} placeholder={field.placeholder} onChange={(value) => updateField(field.name, value)} />
                  ) : (
                    <Input value={String(effectiveFormValues[field.name] ?? '')} placeholder={field.placeholder} onChange={(event) => updateField(field.name, event.target.value)} />
                  )}
                  {field.description && <small>{field.description}</small>}
                </label>
              );
            })}
            {stageProgress && <KkresStageProgressPanel progress={stageProgress} />}
            {selectedSkill?.id === 'export-kkres-image' && (
              <Alert
                className="kkres-import-safety-alert"
                type="warning"
                showIcon
                message={KKRES_IMPORT_SAFETY_TITLE}
                description={KKRES_IMPORT_SAFETY_DESCRIPTION}
              />
            )}
            <Button type="primary" loading={loading} disabled={Boolean(submitDisabledReason)} title={submitDisabledReason || undefined} onClick={() => void submit()}>{submitDisabledReason ? '暂不可提交' : '提交任务'}</Button>
          </Space>
        </Card>

        <Card
          title="任务列表"
          className="agent-job-card agent-job-list-card"
          extra={<Typography.Text type="secondary">{jobs.length} 个</Typography.Text>}
        >
          {bootstrapLoading ? (
            <AgentJobLoadingState message="正在同步任务列表…" />
          ) : jobs.length === 0 ? (
            <div className="agent-job-list-empty">
              <Typography.Text type="secondary">暂无任务。提交任务后会自动出现在这里。</Typography.Text>
            </div>
          ) : (
            <div className="agent-job-list" role="list" aria-label="最近任务列表">
              {jobs.map((job) => (
                <button type="button" key={job.id} className={`agent-job-row ${job.id === activeJob?.id ? 'is-active' : ''}`} onClick={() => setActiveJobId(job.id)} aria-pressed={job.id === activeJob?.id}>
                  <span className={`agent-job-row__rail agent-job-row__rail--${job.status}`} aria-hidden="true" />
                  <span className="agent-job-row__main">
                    <span className="agent-job-row__title">{job.skillLabel}</span>
                    <span className="agent-job-row__time">{formatAgentJobListTime(job.createdAt)}</span>
                  </span>
                  <Tag color={getAgentJobStatusView(job).color}>{getAgentJobStatusView(job).label}</Tag>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="任务详情" className="agent-job-card agent-job-detail-card">
          {bootstrapLoading ? (
            <AgentJobLoadingState message="正在连接任务服务，连接成功后会显示任务详情。" />
          ) : activeJob ? (
            <div className="agent-job-detail">
              <div className="agent-job-detail-hero">
                <div className="agent-job-detail-hero__header">
                  <div className="agent-job-detail-hero__title">
                    <h3>{activeJob.skillLabel}</h3>
                  </div>
                  {activeJobDownloadArtifacts.length > 0 && (
                    <Space wrap size={[8, 8]} className="agent-job-downloads">
                      {activeJobDownloadArtifacts.map((artifact) => (
                        <Button
                          key={artifact.id}
                          size="middle"
                          className="agent-job-download-button"
                          href={getAgentArtifactDownloadUrl(artifact.downloadUrl)}
                          title={`下载 ${artifact.name} (${formatArtifactSize(artifact.sizeBytes)})`}
                          onClick={(event) => void handleArtifactDownload(event, activeJob.id, getAgentArtifactDownloadUrl(artifact.downloadUrl), artifact.name)}
                        >
                          <DownloadOutlined className="agent-job-download-icon" aria-hidden="true" />
                          <span className="agent-job-download-label">下载</span>
                          <span className="agent-job-download-size">{formatArtifactSize(artifact.sizeBytes)}</span>
                        </Button>
                      ))}
                    </Space>
                  )}
                </div>
                <ReadableJobMessage className="agent-job-summary" message={activeJob.summary} />
              </div>
              {visibleArtifactDownloadProgress && <ArtifactDownloadProgressPanel progress={visibleArtifactDownloadProgress} />}
              {showPartialArchiveArtifactWarning && (
                <Alert
                  className="agent-job-partial-artifact-alert"
                  type="warning"
                  showIcon
                  message={PARTIAL_ARCHIVE_ARTIFACT_WARNING_TITLE}
                  description={PARTIAL_ARCHIVE_ARTIFACT_WARNING_DESCRIPTION}
                />
              )}
              {activeJob.status === 'succeeded' && activeJobDownloadArtifacts.length === 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="任务已完成，但没有可下载文件"
                  description="任务服务未生成可下载的 ZIP/KKRES，或产物不适合在当前页面公开下载。请查看执行日志中的下载包/附件提示。"
                />
              )}
              <div className="agent-job-events">
                <div className="agent-job-events-header">
                  <h4>执行日志 / 实时进度</h4>
                  <Typography.Text type="secondary">latest #{activeJobEventMeta?.latestEventId ?? 0}</Typography.Text>
                </div>
                {activeJobEventMeta?.truncatedBefore !== undefined && (
                  <Alert
                    type="warning"
                    showIcon
                    message={`日志窗口已截断，早于 #${activeJobEventMeta.truncatedBefore} 的事件未显示。`}
                  />
                )}
                <AgentJobEventList
                  events={activeJobEvents}
                  emptyMessage="暂无可见进度事件；任务开始后会自动刷新。"
                  logEndRef={logEndRef}
                />
              </div>
            </div>
          ) : (
            <div className="agent-job-detail-empty">
              <Typography.Text type="secondary">选择左侧任务后查看摘要、实时日志与下载结果。</Typography.Text>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}


function ReadableJobMessage({ className, message }: { className: string; message: string }) {
  const segments = summarizeReadableMessage(message);
  return (
    <span className={`agent-job-readable-lines ${className}`} aria-label={message}>
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`} className="agent-job-readable-line">{segment}</span>
      ))}
    </span>
  );
}

function AgentJobLoadingState({ message: loadingMessage }: { message: string }) {
  return (
    <div className="agent-job-loading-state" role="status" aria-live="polite">
      <Typography.Text type="secondary">{loadingMessage}</Typography.Text>
    </div>
  );
}

function getAgentJobStatusView(job: AgentJobSummary): { label: string; color: 'success' | 'error' | 'processing' | 'warning' } {
  switch (job.status) {
    case 'queued':
      return { label: '等待', color: 'warning' };
    case 'running':
      return { label: '执行中', color: 'processing' };
    case 'succeeded':
      return { label: '成功', color: 'success' };
    case 'failed':
      return { label: '重试', color: 'error' };
  }
}

interface KkresImagePathFieldProps {
  label: string;
  required: boolean;
  value: string;
  placeholder?: string;
  description?: string;
  canUseNativePicker: boolean;
  onChange: (value: string) => void;
  onAppendPaths: (paths: string[]) => void;
  onOpenDirectory: () => void;
  onOpenFiles: () => void;
}

function KkresImagePathField({
  label,
  required,
  value,
  placeholder,
  description,
  canUseNativePicker,
  onChange,
  onAppendPaths,
  onOpenDirectory,
  onOpenFiles,
}: KkresImagePathFieldProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const paths = getDroppedKkresImagePaths(event.dataTransfer);
    if (paths.length === 0) {
      message.warning('未检测到可用的本地图片或文件夹路径；Web 模式可手动粘贴路径。');
      return;
    }
    onAppendPaths(paths);
  }, [onAppendPaths]);

  return (
    <div className="agent-job-field agent-job-field--kkres-images">
      <span>{label}{required ? ' *' : ''}</span>
      <div
        className={`kkres-image-dropzone${isDragging ? ' kkres-image-dropzone--dragging' : ''}`}
        role="region"
        aria-label="选择或拖入 kkres 图片路径"
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
      >
        <div className="kkres-image-dropzone__header">
          <strong>{isDragging ? '释放后添加路径' : '选择本机图片并自动暂存'}</strong>
          <span>提交时会先上传本机图片，再把 staging: 标识发送给任务服务。</span>
        </div>
        <Space wrap>
          <Button type="default" onClick={onOpenDirectory} disabled={!canUseNativePicker}>选择图片文件夹</Button>
          <Button onClick={onOpenFiles} disabled={!canUseNativePicker}>选择图片文件</Button>
        </Space>
        {!canUseNativePicker && <small>Web 模式请使用上传后返回的 staging: 或 public-input/ 图片标识。</small>}
      </div>
      <div
        className="kkres-image-textarea-drop-target"
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
      >
        <Input.TextArea
          rows={5}
          value={value}
          placeholder={placeholder ?? '每行一个本机图片/文件夹路径、staging:xxx.png 或 public-input/xxx.png'}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {description && <small>{description}</small>}
    </div>
  );
}


function KkresStageProgressPanel({ progress }: { progress: StageProgressState }) {
  const status = progress.phase === 'failed' ? 'exception' : progress.phase === 'complete' ? 'success' : 'active';
  const byteText = progress.totalBytes > 0 ? `${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}` : '正在计算总大小…';
  const fileText = progress.totalFiles > 0 ? `${progress.currentFileIndex}/${progress.totalFiles}` : '扫描中';
  return (
    <div className="kkres-stage-progress" role="status" aria-live="polite">
      <div className="kkres-stage-progress__header">
        <strong>{progress.message}</strong>
        <span>{fileText} · {byteText}</span>
      </div>
      <Progress percent={progress.percent} size="small" status={status} />
    </div>
  );
}

function ArtifactDownloadProgressPanel({ progress }: { progress: AgentArtifactDownloadProgress }) {
  const status = progress.phase === 'failed' ? 'exception' : progress.phase === 'complete' ? 'success' : progress.phase === 'cancelled' ? 'normal' : 'active';
  const waitingForSaveLocation = progress.message.includes('选择保存位置');
  const percent = !waitingForSaveLocation && progress.totalBytes > 0 ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100)) : 0;
  const byteText = waitingForSaveLocation ? '等待确认保存位置' : progress.totalBytes > 0 ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}` : formatBytes(progress.receivedBytes);
  return (
    <div className="agent-artifact-download-progress" role="status" aria-live="polite">
      <div className="agent-artifact-download-progress__header">
        <strong>{progress.message}</strong>
        <span>{progress.filename} · {byteText}</span>
      </div>
      <Progress percent={percent} size="small" status={status} />
    </div>
  );
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}


async function prepareAgentSubmitParams(
  skillId: AgentSkillDefinition['id'],
  params: AgentSubmitRequest['params'],
  onImagesPrepared?: (images: string) => void,
  stageRequestId?: string,
  onStageStart?: (requestId: string) => void,
): Promise<AgentSubmitRequest['params']> {
  if (skillId !== 'export-kkres-image') return params;
  const imageLines = splitLineValues(params.images);
  const preparedLines: string[] = [];
  const localInputs: string[] = [];
  for (const image of imageLines) {
    if (isKkresPublicImageIdentifier(image)) preparedLines.push(image);
    else localInputs.push(image);
  }
  if (localInputs.length === 0) return params;
  const stagingApi = window.electronAPI?.stageKkresImageInputs;
  if (!stagingApi) {
    throw new Error('本机图片路径需要桌面版先上传暂存；Web 模式请填写 staging: 或 public-input/ 图片标识。');
  }
  const requestId = stageRequestId ?? createKkresStageRequestId();
  onStageStart?.(requestId);
  message.loading({ content: `正在上传暂存 ${localInputs.length} 个 kkres 本机输入…`, key: 'kkres-stage' });
  const staged = await stagingApi({ inputs: localInputs, ownerToken: getAgentOwnerToken(), requestId });
  if (!staged.success) {
    message.destroy('kkres-stage');
    throw new Error(staged.error);
  }
  const images = [...preparedLines, ...staged.identifiers].join('\n');
  onImagesPrepared?.(images);
  message.success({ content: `已上传暂存 ${staged.identifiers.length} 张 kkres 图片`, key: 'kkres-stage' });
  return { ...params, images };
}

function splitLineValues(value: unknown): string[] {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isKkresPublicImageIdentifier(value: string): boolean {
  return /^staging:[A-Za-z0-9._/-]+\.(png|jpe?g|webp|bmp)$/i.test(value)
    || /^public-input\/[A-Za-z0-9._/-]+\.(png|jpe?g|webp|bmp)$/i.test(value);
}

function mergeLineValues(current: string, additions: string[]): string {
  const lines = current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const addition of additions) {
    if (!lines.includes(addition)) lines.push(addition);
  }
  return lines.join('\n');
}

function normalizeKkresImagePaths(paths: string[]): string[] {
  return paths.map((path) => path.trim()).filter(Boolean);
}

function getDroppedKkresImagePaths(dataTransfer: DataTransfer): string[] {
  const paths = Array.from(dataTransfer.files ?? [])
    .map((file) => (file as File & { path?: unknown }).path)
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0);
  return normalizeKkresImagePaths(paths);
}

function visibleDownloadArtifacts(job: AgentJobSummary) {
  if (job.skillId === 'fetch-archive-changes' || job.skillId === 'fetch-mismatch-logs') {
    return job.artifacts.filter((artifact) => artifact.name.toLowerCase().endsWith('.zip'));
  }
  if (job.skillId === 'export-kkres-image') {
    return job.artifacts.filter((artifact) => artifact.name.toLowerCase().endsWith('.kkres'));
  }
  return job.artifacts;
}
