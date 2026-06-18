import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { Button, Alert, Card, Input, InputNumber, Progress, Select, Space, Tag, Typography, message } from 'antd';
import { fetchAgentHealth, getAgentArtifactDownloadUrl, fetchAgentJob, fetchAgentJobEvents, fetchAgentJobs, fetchAgentSkills, getAgentOwnerToken, submitAgentJob } from './api';
import { applyAgentParamDefaults, getAgentParamDefaults, validateAgentParams } from './catalog';
import type { AgentHealthResponse, AgentJobEvent, AgentJobEventsResponse, AgentJobSummary, AgentSkillDefinition, AgentSubmitRequest } from './types';
import { AgentJobEventList } from './AgentJobEventList';
import { filterUserVisibleJobEvents } from './eventVisibility';
import { getAgentQueueStatus, getAgentRunnerStatus, hasActiveAgentJobs, isTerminalAgentJob, refreshActiveAgentJobs } from './agentJobCenterStatus';
import { handleAgentArtifactDownloadClick } from './artifactDownload';
import { createKkresStageRequestId, subscribeToActiveStageProgress, type StageProgressState } from './stageProgress';
import type { AgentArtifactDownloadProgress } from '../types/electron';


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
  const [loading, setLoading] = useState(false);
  const [stageProgress, setStageProgress] = useState<StageProgressState | null>(null);
  const [artifactDownloadProgress, setArtifactDownloadProgress] = useState<AgentArtifactDownloadProgress | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const latestEventIdsRef = useRef<Record<string, number>>({});
  const activeStageRequestIdRef = useRef<string | null>(null);

  const selectedSkill = useMemo(() => skills.find((skill) => skill.id === selectedSkillId) ?? skills[0], [selectedSkillId, skills]);
  const effectiveFormValues = useMemo(() => (selectedSkill ? applyAgentParamDefaults(selectedSkill.id, formValues) : formValues), [selectedSkill, formValues]);
  const activeJob = useMemo(() => jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null, [activeJobId, jobs]);
  const activeJobStableId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  const activeJobEvents = useMemo(() => (activeJob ? jobEvents[activeJob.id] ?? [] : []), [activeJob, jobEvents]);
  const visibleActiveJobEvents = useMemo(() => filterUserVisibleJobEvents(activeJobEvents), [activeJobEvents]);
  const activeJobEventMeta = activeJob ? jobEventMeta[activeJob.id] : undefined;
  const activeJobDownloadArtifacts = useMemo(() => (activeJob ? visibleDownloadArtifacts(activeJob) : []), [activeJob]);
  const serviceStatus = useMemo(() => getAgentRunnerStatus(health), [health]);
  const queueStatus = useMemo(() => getAgentQueueStatus(health), [health]);
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
    if (!selectedSkillId && skillPayload.skills[0]) setSelectedSkillId(skillPayload.skills[0].id);
  }, [selectedSkillId]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
    setArtifactDownloadProgress(progress);
  }) ?? (() => undefined), []);

  const handleArtifactDownload = async (event: MouseEvent<HTMLElement>, artifactUrl: string, artifactName?: string) => {
    setArtifactDownloadProgress({
      id: `pending-${Date.now()}`,
      url: artifactUrl,
      filename: artifactName || artifactUrl.split('/').pop()?.split('?')[0] || 'artifact',
      receivedBytes: 0,
      totalBytes: 0,
      phase: 'started',
      message: '正在打开保存位置选择…',
    });
    const result = await handleAgentArtifactDownloadClick(event, artifactUrl, artifactName, window.electronAPI);
    if (result.error) {
      setError(result.error);
      setArtifactDownloadProgress((current) => current ? { ...current, phase: 'failed', message: result.error ?? '下载失败' } : current);
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
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError(null)} />}

      <div className="agent-job-workspace">
        <Card title="提交任务" className="agent-job-card agent-job-submit-card">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
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
            {selectedSkill && <Typography.Paragraph type="secondary">{selectedSkill.description}</Typography.Paragraph>}
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
            <Button type="primary" loading={loading} onClick={() => void submit()}>提交任务</Button>
          </Space>
        </Card>

        <Card
          title="任务列表"
          className="agent-job-card agent-job-list-card"
          extra={<Typography.Text type="secondary">{jobs.length} 个</Typography.Text>}
        >
          {jobs.length === 0 ? (
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
          {activeJob ? (
            <div className="agent-job-detail">
              <h3>{activeJob.skillLabel}</h3>
              <p>{activeJob.summary}</p>
              <Space wrap>
                {activeJobDownloadArtifacts.map((artifact) => (
                  <Button
                    key={artifact.id}
                    href={getAgentArtifactDownloadUrl(artifact.downloadUrl)}
                    onClick={(event) => void handleArtifactDownload(event, getAgentArtifactDownloadUrl(artifact.downloadUrl), artifact.name)}
                  >
                    下载 {artifact.name} ({artifact.sizeBytes} bytes)
                  </Button>
                ))}
              </Space>
              {artifactDownloadProgress && <ArtifactDownloadProgressPanel progress={artifactDownloadProgress} />}
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

function formatAgentJobListTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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
