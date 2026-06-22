import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { inflateRawSync } from 'node:zlib';
import type { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isAgentSkillId, validateAgentParams, TRUSTED_RUNNER_WARNING } from '../../src/agentJobs/catalog';
import type { AgentArtifact, AgentDiagnosticsResponse, AgentHealthResponse, AgentJobStatus, AgentJobSummary } from '../../src/agentJobs/types';
import { AGENT_SKILL_CONTRACTS, buildAgentExecution, buildMockAgentCommand, checkAgentProvider, type AgentJobEvent, type AgentResultManifest, type RunnerCommand, type RunnerConfig } from './contracts';

const EVENTS_FILE = 'events.jsonl';
const STATE_FILE = 'job-state.json';
const PROGRESS_FILE = 'progress.jsonl';
const EVENT_LOG_VERSION = 1;
const JOB_STATE_VERSION = 1;
const MAX_EVENT_RESPONSE = 500;
const MAX_PUBLIC_ZIP_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES = 100 * 1024 * 1024;
const PUBLIC_ARTIFACT_DIR = '.public-artifacts';
const WINDOWS_PATH_PATTERN = /[A-Za-z]:(?:\\\\|\\)[^\s;,)"]+/g;
const UNC_PATH_PATTERN = /\\\\[^\s;,)"]+/g;
const POSIX_MOUNT_PATH_PATTERN = /\/mnt\/[a-z]\/[^\s;,)"]+/g;
const SENSITIVE_ENV_ASSIGNMENT_PATTERN = /\b[A-Z0-9_]*(?:AGENT|Y3|VITE|TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*=[^\s;,)"]+/gi;
const DANGEROUS_EXECUTABLE_TEXT_PATTERN = /(?:\.exe|\.bat|\.cmd|\.ps1|\.sh|\.py)(?:\s|$)/i;
const RECOVERY_EVENT_SUMMARY = 'Agent runner restarted; real jobs are not resumed automatically';
const RUNTIME_GATED_SKILLS = new Set(['fetch-mismatch-logs', 'export-kkres-image']);
const DEFAULT_MAX_RUNNING_JOBS = 5;
const DEFAULT_MAX_QUEUED_JOBS = 10;


interface InternalArtifact extends AgentArtifact {
  relativePath: string;
}

export interface StoredJob extends Omit<AgentJobSummary, 'artifacts'> {
  artifacts: InternalArtifact[];
  outputDir: string;
  params: Record<string, unknown>;
  ownerToken: string;
  promptPath?: string;
  error?: string;
  safeResume: boolean;
  progressOffset: number;
  sourceKey?: string;
  sourceAggregateKey?: string;
  sourceNetworkKey?: string;
}

type QueueItem = { job: StoredJob; command: RunnerCommand };

type RunCommandResult = { output: string; exitCode: number };

interface EventEnvelope {
  version: typeof EVENT_LOG_VERSION;
  event: AgentJobEvent;
}

interface PersistedJobState {
  version: typeof JOB_STATE_VERSION;
  job: StoredJob;
}

interface EventAppendOptions {
  updateState?: boolean;
}

interface JobEventQueryResult {
  events: AgentJobEvent[];
  latestEventId: number;
  truncatedBefore?: number;
}

export class AgentJobStore {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly queue: QueueItem[] = [];
  private runningCount = 0;
  private pendingSubmissions = 0;
  private readonly pendingSourceSubmissions = new Map<string, number>();
  private readonly config: RunnerConfig;
  private readonly restoreReady: Promise<void>;
  private readonly eventWriteChains = new Map<string, Promise<unknown>>();

  constructor(config: RunnerConfig) {
    this.config = config;
    this.restoreReady = this.restoreJobs();
  }

  async ready(): Promise<void> {
    await this.restoreReady;
  }

  listSkills() {
    return Object.values(AGENT_SKILL_CONTRACTS).map((contract) => contract.skill);
  }

  async health(): Promise<AgentHealthResponse> {
    await this.ready();
    const queue = this.queueStatus();
    const provider = await checkAgentProvider(this.config);
    const skillHealth = await Promise.all(Object.values(AGENT_SKILL_CONTRACTS).map((contract) => contract.checkHealth(this.config)));
    return {
      ready: !queue.submissionsDisabled && provider.ready && skillHealth.every((skill) => skill.ready),
      trustedOnly: true,
      warning: TRUSTED_RUNNER_WARNING,
      queue,
      skills: Object.values(AGENT_SKILL_CONTRACTS).map((contract) => ({
        skillId: contract.skill.id,
        label: contract.skill.label,
      })),
    };
  }

  async diagnostics(): Promise<AgentDiagnosticsResponse> {
    await this.ready();
    const provider = await checkAgentProvider(this.config);
    const skillDiagnostics = await Promise.all(Object.values(AGENT_SKILL_CONTRACTS).map(async (contract) => {
      const result = await contract.checkHealth(this.config);
      return {
        skillId: contract.skill.id,
        label: contract.skill.label,
        ready: result.ready,
        details: result.details,
      };
    }));
    return {
      ...(await this.health()),
      ready: !this.config.submissionsDisabled && provider.ready && skillDiagnostics.every((skill) => skill.ready),
      host: this.config.host,
      port: this.config.port,
      allowLan: this.config.allowLan,
      agentProvider: provider,
      skillDiagnostics,
    };
  }

  queueStatus() {
    return {
      running: this.runningCount,
      queued: this.queue.length + this.pendingSubmissions,
      maxRunning: maxRunningJobsForConfig(this.config),
      maxQueued: maxQueuedJobsForConfig(this.config),
      submissionsDisabled: this.config.submissionsDisabled,
    };
  }

  async submit(skillId: string, params: Record<string, unknown>, ownerToken?: string, sourceKey = 'unknown'): Promise<AgentJobSummary> {
    await this.ready();
    const normalizedOwnerToken = normalizeOwnerToken(ownerToken);
    if (this.config.submissionsDisabled) throw new Error('Service is in maintenance mode; new jobs are disabled');
    if (!this.canAcceptSubmission()) throw new Error('Service busy: running and queued job limits reached; please try again later');
    if (!isAgentSkillId(skillId)) throw new Error(`Unknown skill: ${skillId}`);
    const throttleKey = sourceThrottleKey(normalizedOwnerToken, sourceKey, skillId);
    const aggregateThrottleKey = sourceAggregateThrottleKey(normalizedOwnerToken, sourceKey);
    const networkThrottleKey = sourceNetworkThrottleKey(sourceKey);
    if (!this.canAcceptSourceSubmission(throttleKey) || !this.canAcceptAggregateSourceSubmission(aggregateThrottleKey) || !this.canAcceptNetworkSourceSubmission(networkThrottleKey)) {
      throw new Error('Source throttled: this browser or network source has too many active jobs; please try again later');
    }
    this.pendingSubmissions += 1;
    this.incrementPendingSource(throttleKey);
    this.incrementPendingSource(aggregateThrottleKey);
    this.incrementPendingSource(networkThrottleKey);
    let pendingReleased = false;
    const releasePendingSubmission = () => {
      if (pendingReleased) return;
      pendingReleased = true;
      this.pendingSubmissions -= 1;
      this.decrementPendingSource(throttleKey);
      this.decrementPendingSource(aggregateThrottleKey);
      this.decrementPendingSource(networkThrottleKey);
    };
    try {
      const validationErrors = validateAgentParams(skillId, params);
      if (validationErrors.length > 0) throw new Error(validationErrors.join('; '));
      const resolvedParams = await resolvePublicParams(skillId, params, this.config);

      const contract = AGENT_SKILL_CONTRACTS[skillId];
      if (!this.config.mockMode && RUNTIME_GATED_SKILLS.has(skillId)) {
        const runtimeHealth = await contract.checkHealth(this.config);
        if (!runtimeHealth.ready) {
          throw new Error(`${contract.skill.label} runtime not ready: ${runtimeHealth.details.join('; ')}`);
        }
      }

      const id = createJobId();
      const now = new Date().toISOString();
      const outputDir = path.join(this.config.jobsRoot, id);
      await fs.mkdir(outputDir, { recursive: true });
      const job: StoredJob = {
        id,
        skillId,
        skillLabel: contract.skill.label,
        status: 'queued',
        summary: 'Agent 任务已排队',
        createdAt: now,
        updatedAt: now,
        artifacts: [],
        outputDir,
        params: resolvedParams,
        ownerToken: normalizedOwnerToken,
        safeResume: false,
        progressOffset: 0,
        sourceKey: throttleKey,
        sourceAggregateKey: aggregateThrottleKey,
        sourceNetworkKey: networkThrottleKey,
      };
      this.jobs.set(id, job);
      await this.recordEvent(job, 'queued', { message: job.summary }, { updateState: false });
      await this.writeJobState(job);
      const execution = await buildAgentExecution(skillId, resolvedParams, outputDir, this.config);
      job.promptPath = execution.promptPath;
      await this.recordEvent(job, 'prompt-created', { message: 'Agent prompt 已生成' });
      const command = this.config.mockMode
        ? buildMockAgentCommand(outputDir, skillId, params)
        : execution.command;
      releasePendingSubmission();
      this.queue.push({ job, command });
      this.pumpQueue();
      return publicJob(job);
    } catch (err) {
      releasePendingSubmission();
      throw err;
    }
  }

  private canAcceptSubmission(): boolean {
    const acceptedActiveJobs = this.runningCount + this.queue.length + this.pendingSubmissions;
    return acceptedActiveJobs < maxRunningJobsForConfig(this.config) + maxQueuedJobsForConfig(this.config);
  }

  private canAcceptSourceSubmission(sourceKey: string): boolean {
    const active = countActiveJobs(Array.from(this.jobs.values()), (job) => job.sourceKey === sourceKey);
    return active + (this.pendingSourceSubmissions.get(sourceKey) || 0) < maxActiveJobsPerSourceForConfig(this.config);
  }

  private canAcceptAggregateSourceSubmission(sourceAggregateKey: string): boolean {
    const active = countActiveJobs(Array.from(this.jobs.values()), (job) => job.sourceAggregateKey === sourceAggregateKey);
    return active + (this.pendingSourceSubmissions.get(sourceAggregateKey) || 0) < maxActiveJobsPerSourceForConfig(this.config);
  }

  private canAcceptNetworkSourceSubmission(sourceNetworkKey: string): boolean {
    const active = countActiveJobs(Array.from(this.jobs.values()), (job) => job.sourceNetworkKey === sourceNetworkKey);
    return active + (this.pendingSourceSubmissions.get(sourceNetworkKey) || 0) < maxActiveJobsPerSourceForConfig(this.config);
  }

  private incrementPendingSource(sourceKey: string): void {
    this.pendingSourceSubmissions.set(sourceKey, (this.pendingSourceSubmissions.get(sourceKey) || 0) + 1);
  }

  private decrementPendingSource(sourceKey: string): void {
    const next = (this.pendingSourceSubmissions.get(sourceKey) || 0) - 1;
    if (next > 0) this.pendingSourceSubmissions.set(sourceKey, next);
    else this.pendingSourceSubmissions.delete(sourceKey);
  }

  listJobs(ownerToken?: string): AgentJobSummary[] {
    const normalizedOwnerToken = normalizeOwnerTokenForRead(ownerToken);
    if (!normalizedOwnerToken) return [];
    return Array.from(this.jobs.values())
      .filter((job) => job.ownerToken === normalizedOwnerToken)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicJob);
  }

  getJob(id: string, ownerToken?: string): AgentJobSummary | undefined {
    const normalizedOwnerToken = normalizeOwnerTokenForRead(ownerToken);
    if (!normalizedOwnerToken) return undefined;
    const job = this.jobs.get(id);
    return job && job.ownerToken === normalizedOwnerToken ? publicJob(job) : undefined;
  }

  async getJobEvents(jobId: string, ownerToken?: string, after = 0): Promise<JobEventQueryResult | null> {
    await this.ready();
    const normalizedOwnerToken = normalizeOwnerTokenForRead(ownerToken);
    if (!normalizedOwnerToken) return null;
    const eventCursor = after;
    const job = this.jobs.get(jobId);
    if (!job || job.ownerToken !== normalizedOwnerToken) return null;
    const normalizedAfter = Number.isFinite(eventCursor) && eventCursor > 0 ? Math.floor(eventCursor) : 0;
    await this.ingestProgress(job);
    const events = await readEventFile(job.outputDir);
    const latestEventId = events.length ? Math.max(...events.map((event) => event.id)) : 0;
    const matching = events.filter((event) => event.id > normalizedAfter);
    const bounded = matching.slice(-MAX_EVENT_RESPONSE);
    const result: JobEventQueryResult = { events: bounded.map(publicEvent), latestEventId };
    if (matching.length > bounded.length && bounded[0]) result.truncatedBefore = bounded[0].id;
    return result;
  }

  async getArtifact(jobId: string, artifactId: string, ownerToken?: string): Promise<{ path: string; name: string } | null> {
    await this.ready();
    const normalizedOwnerToken = normalizeOwnerTokenForRead(ownerToken);
    if (!normalizedOwnerToken) return null;
    const job = this.jobs.get(jobId);
    if (!job || job.ownerToken !== normalizedOwnerToken) return null;
    const artifact = job.artifacts.find((candidate) => candidate.id === artifactId && isPublicDownloadArtifact(job, candidate));
    if (!artifact) return null;
    const rawPath = path.join(job.outputDir, artifact.relativePath);
    const safe = await resolveUnder(job.outputDir, rawPath);
    if (!safe) return null;
    return { path: safe, name: artifact.name };
  }


  private pumpQueue(): void {
    while (this.runningCount < maxRunningJobsForConfig(this.config) && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.runningCount += 1;
      void this.runJob(item.job, item.command).finally(() => {
        this.runningCount -= 1;
        this.pumpQueue();
      });
    }
  }

  private async runJob(job: StoredJob, command: RunnerCommand): Promise<void> {
    await this.mark(job, 'running', 'Agent 执行中');
    job.startedAt = job.updatedAt;
    await this.writeJobState(job);
    try {
      await fs.mkdir(command.outputDir, { recursive: true });
      const result = await runCommand(command, this.config.maxCapturedOutputChars, job, this);
      const contract = AGENT_SKILL_CONTRACTS[job.skillId];
      const manifest = await readManifest(command.outputDir);
      await this.recordEvent(job, 'manifest-read', { message: `Manifest 已读取：${redactPublicText(manifest.summary)}` }, { updateState: false });
      if (manifest.status !== 'succeeded') throw new Error(manifest.summary || 'Agent manifest reported failure');
      const artifactPaths = await manifestArtifactPaths(command.outputDir, manifest, contract.discoverArtifacts, contract.downloadableExtensions);
      const validationErrors = await contract.validateSuccess({ output: result.output, outputDir: command.outputDir, artifacts: artifactPaths, manifest });
      if (validationErrors.length > 0) throw new Error(validationErrors.join('; '));
      await this.recordEvent(job, 'artifacts-validated', { message: `Artifact 校验完成：${artifactPaths.length} 个候选文件` }, { updateState: false });
      job.artifacts = await buildArtifacts(job, artifactPaths);
      await this.mark(job, 'succeeded', summarizeSuccess(manifest, result.output, job.artifacts.length));
    } catch (err) {
      job.error = redactPublicText(err instanceof Error ? err.message : String(err));
      await this.mark(job, 'failed', `Agent 任务失败：${job.error}`);
    } finally {
      job.finishedAt = job.updatedAt;
      await this.writeJobState(job);
    }
  }

  private async restoreJobs(): Promise<void> {
    await fs.mkdir(this.config.jobsRoot, { recursive: true });
    const entries = await fs.readdir(this.config.jobsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const outputDir = path.join(this.config.jobsRoot, entry.name);
      const restored = await readJobState(outputDir);
      if (!restored) continue;
      const job = restored.job;
      if (!job.ownerToken) continue;
      if (job.outputDir !== outputDir) job.outputDir = outputDir;
      job.progressOffset = Number.isFinite(job.progressOffset) ? job.progressOffset : 0;
      try {
        job.ownerToken = normalizeOwnerToken(job.ownerToken);
      } catch {
        continue;
      }
      if (!job.sourceAggregateKey && job.sourceKey) job.sourceAggregateKey = job.sourceKey.replace(/:[^:]+$/, '');
      if (!job.sourceNetworkKey) job.sourceNetworkKey = restoredNetworkThrottleKey(job);
      if (job.status === 'succeeded' && job.artifacts.length === 0) {
        job.artifacts = await restorePublicArtifacts(job);
        if (job.artifacts.length > 0) await this.writeJobState(job);
      }
      const previousStatus = job.status;
      const wasActive = previousStatus === 'queued' || previousStatus === 'running';
      this.jobs.set(job.id, job);
      if (wasActive) {
        if (job.safeResume) {
          job.summary = `${RECOVERY_EVENT_SUMMARY}; safeResume metadata present but automatic resume is disabled for MVP`;
        } else {
          job.summary = RECOVERY_EVENT_SUMMARY;
        }
        job.status = 'failed';
        job.error = RECOVERY_EVENT_SUMMARY;
        job.finishedAt = new Date().toISOString();
        job.updatedAt = job.finishedAt;
        await this.recordEvent(job, 'recovery', {
          message: job.summary,
          safeResume: job.safeResume,
          previousStatus,
        });
        await this.recordEvent(job, 'failed', { message: job.summary });
      }
    }
  }



  private async ingestProgress(job: StoredJob): Promise<void> {
    const filePath = path.join(job.outputDir, PROGRESS_FILE);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(filePath, 'r');
      const stat = await handle.stat();
      if (job.progressOffset > stat.size) job.progressOffset = 0;
      if (job.progressOffset === stat.size) return;
      const length = stat.size - job.progressOffset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, job.progressOffset);
      job.progressOffset = stat.size;
      const content = buffer.toString('utf8');
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const progress = parseProgressLine(line);
        await this.recordEvent(job, 'progress', progress, { updateState: false });
      }
      await this.writeJobState(job);
    } catch {
      return;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async recordEvent(
    job: StoredJob,
    type: AgentJobEvent['type'],
    data: Omit<AgentJobEvent, 'id' | 'jobId' | 'type' | 'createdAt'>,
    options: EventAppendOptions = {},
  ): Promise<AgentJobEvent> {
    const previousWrite = this.eventWriteChains.get(job.id) ?? Promise.resolve();
    const eventWrite = previousWrite.catch(() => undefined).then(() => appendEvent(job.outputDir, { jobId: job.id, type, ...data }));
    this.eventWriteChains.set(job.id, eventWrite.catch(() => undefined));
    const event = await eventWrite;
    if (options.updateState !== false) await this.writeJobState(job);
    return event;
  }

  private async mark(job: StoredJob, status: AgentJobStatus, summary: string): Promise<void> {
    const updatedAt = new Date().toISOString();
    if (status === 'running') {
      job.status = status;
      job.summary = summary;
      job.updatedAt = updatedAt;
      await this.writeJobState(job);
      return;
    }
    await this.recordEvent(job, status, { message: summary }, { updateState: false });
    job.status = status;
    job.summary = summary;
    job.updatedAt = updatedAt;
    await this.writeJobState(job);
  }

  private async writeJobState(job: StoredJob): Promise<void> {
    await fs.mkdir(job.outputDir, { recursive: true });
    const payload: PersistedJobState = { version: JOB_STATE_VERSION, job };
    const statePath = path.join(job.outputDir, STATE_FILE);
    const tempPath = path.join(job.outputDir, `${STATE_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await replaceFile(tempPath, statePath);
  }
}

async function replaceFile(tempPath: string, targetPath: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath);
      return;
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EEXIST') throw err;
      await fs.rm(targetPath, { force: true }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}


function normalizeOwnerToken(ownerToken: unknown): string {
  if (typeof ownerToken !== 'string' || !ownerToken.trim()) throw new Error('Owner token is required');
  const normalized = ownerToken.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) throw new Error('Owner token is invalid');
  return normalized;
}

function normalizeOwnerTokenForRead(ownerToken: unknown): string | null {
  try {
    return normalizeOwnerToken(ownerToken);
  } catch {
    return null;
  }
}

function maxRunningJobsForConfig(config: RunnerConfig): number {
  return Math.min(DEFAULT_MAX_RUNNING_JOBS, Math.max(1, Math.floor(config.maxConcurrentJobs || DEFAULT_MAX_RUNNING_JOBS)));
}

function maxQueuedJobsForConfig(config: RunnerConfig): number {
  return Math.min(DEFAULT_MAX_QUEUED_JOBS, Math.max(0, Math.floor(config.maxQueuedJobs ?? DEFAULT_MAX_QUEUED_JOBS)));
}

function maxActiveJobsPerSourceForConfig(config: RunnerConfig): number {
  return Math.max(1, Math.floor(config.maxActiveJobsPerSource || 2));
}


async function resolvePublicParams(skillId: StoredJob['skillId'], params: Record<string, unknown>, config: RunnerConfig): Promise<Record<string, unknown>> {
  if (skillId !== 'export-kkres-image') return params;
  const root = config.kkresPublicInputRoot;
  if (!root?.trim()) throw new Error('KKRes public image input root is not configured');
  const resolvedImages = await Promise.all(lines(params.images).map((identifier) => resolvePublicImageIdentifier(root, identifier)));
  return { ...params, images: resolvedImages.join('\n') };
}

async function resolvePublicImageIdentifier(root: string, identifier: string): Promise<string> {
  const relative = publicImageIdentifierToRelativePath(identifier);
  if (!relative) throw new Error('图片标识 must be staging:*.png/jpg/webp or public-input/*.png/jpg/webp, not a local path');
  const resolved = await resolveUnder(root, path.join(root, relative));
  if (!resolved) throw new Error('图片标识 does not resolve under the configured public input root');
  return resolved;
}

function publicImageIdentifierToRelativePath(identifier: string): string | null {
  if (identifier.startsWith('staging:')) return path.join('staging', identifier.slice('staging:'.length));
  if (identifier.startsWith('public-input/')) return identifier.slice('public-input/'.length);
  return null;
}

function lines(value: unknown): string[] {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function countActiveJobs(jobs: StoredJob[], matches: (job: StoredJob) => boolean): number {
  return jobs.filter((job) => matches(job) && (job.status === 'queued' || job.status === 'running')).length;
}

function sourceAggregateThrottleKey(ownerToken: string, sourceKey: string): string {
  return `${ownerToken}:${sourceKey || 'unknown'}`;
}

function sourceThrottleKey(ownerToken: string, sourceKey: string, skillId: string): string {
  return `${sourceAggregateThrottleKey(ownerToken, sourceKey)}:${skillId}`;
}

function sourceNetworkThrottleKey(sourceKey: string): string {
  return `network:${sourceKey || 'unknown'}`;
}

function restoredNetworkThrottleKey(job: StoredJob): string {
  if (job.sourceAggregateKey) {
    const [, ...sourceParts] = job.sourceAggregateKey.split(':');
    if (sourceParts.length) return sourceNetworkThrottleKey(sourceParts.join(':'));
  }
  return sourceNetworkThrottleKey(job.sourceKey || 'unknown');
}

function publicJob(job: StoredJob): AgentJobSummary {
  const artifacts = job.artifacts.filter((artifact) => isPublicDownloadArtifact(job, artifact));
  return {
    id: job.id,
    skillId: job.skillId,
    skillLabel: job.skillLabel,
    status: job.status,
    summary: publicSummary(redactPublicText(job.summary), job, artifacts.length),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    artifacts: artifacts.map((artifact) => ({ id: artifact.id, name: redactArtifactName(artifact.name), sizeBytes: artifact.sizeBytes, downloadUrl: artifact.downloadUrl })),
  };
}

function isPublicDownloadArtifact(job: StoredJob, artifact: InternalArtifact): boolean {
  const extensions = AGENT_SKILL_CONTRACTS[job.skillId]?.downloadableExtensions;
  if (!extensions?.length) return true;
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  return allowed.has(path.extname(artifact.name).toLowerCase()) && isSafePublicArtifact(job.skillId, artifact);
}

function publicSummary(summary: string, job: StoredJob, artifactCount: number): string {
  const extensions = AGENT_SKILL_CONTRACTS[job.skillId]?.downloadableExtensions;
  if (!extensions?.includes('.zip')) return redactPublicText(summary);
  const replacement = artifactCount > 0 ? `生成 ${artifactCount} 个下载包。` : '未发现下载包。';
  return redactPublicText(summary).replace(/生成 \d+ 个附件。?/, replacement);
}

function redactPublicText(value: string): string {
  return redactPublicTextContent(value).slice(0, 1000);
}

function redactPublicTextContent(value: string): string {
  return String(value)
    .replace(WINDOWS_PATH_PATTERN, '[local-path]')
    .replace(UNC_PATH_PATTERN, '[local-path]')
    .replace(POSIX_MOUNT_PATH_PATTERN, '[local-path]')
    .replace(SENSITIVE_ENV_ASSIGNMENT_PATTERN, '[env]');
}

function redactArtifactName(value: string): string {
  return path.basename(redactPublicText(value)).replace(/[^A-Za-z0-9._() -]/g, '_') || 'artifact';
}

function isSafePublicArtifact(skillId: StoredJob['skillId'], artifact: InternalArtifact): boolean {
  const name = artifact.name.replace(/\\/g, '/');
  if (name.includes('..') || path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name) || name.startsWith('//')) return false;
  if (/stdout|stderr|debug|diagnostic|env|command/i.test(name)) return false;
  const extension = path.extname(name).toLowerCase();
  if (skillId === 'export-kkres-image') return extension === '.kkres';
  if (skillId === 'fetch-archive-changes' || skillId === 'fetch-mismatch-logs') return extension === '.zip' && !hasUnsafeArchiveName(name);
  return true;
}

function hasUnsafeArchiveName(name: string): boolean {
  return /(?:\.exe|\.bat|\.cmd|\.ps1|\.sh|\.py|\.js)$/i.test(name);
}


async function preparePublicArtifact(skillId: StoredJob['skillId'], filePath: string, outputDir: string): Promise<PreparedArtifact | null> {
  const extension = path.extname(filePath).toLowerCase();
  if (skillId === 'export-kkres-image') return extension === '.kkres' ? { path: filePath, trustedContent: false } : null;
  if (extension !== '.zip') return await hasSafePublicArtifactContent(skillId, filePath) ? { path: filePath, trustedContent: false } : null;
  const safeZip = await sanitizedPublicZipArtifact(filePath, outputDir);
  return safeZip ? { path: safeZip, trustedContent: true } : null;
}

async function sanitizedPublicZipArtifact(filePath: string, outputDir: string): Promise<string | null> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_PUBLIC_ZIP_ARTIFACT_BYTES) return null;
  const sanitized = await sanitizeZipArtifactOffThread(await fs.readFile(filePath));
  if (!sanitized) return null;

  const publicDir = path.join(outputDir, PUBLIC_ARTIFACT_DIR);
  await fs.mkdir(publicDir, { recursive: true });
  const publicName = path.basename(filePath);
  const publicPath = path.join(publicDir, publicName);
  await fs.writeFile(publicPath, sanitized);
  return publicPath;
}


async function sanitizeZipArtifactOffThread(buffer: Buffer): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'zipSanitizerWorker.cjs');
    const worker = new Worker(workerPath, { workerData: buffer });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new Error('Timed out while sanitizing public zip artifact')));
    }, 120_000);
    worker.once('message', (message: { ok: true; buffer: Uint8Array | null } | { ok: false; error: string }) => {
      finish(() => {
        if (!message.ok) reject(new Error(message.error));
        else resolve(message.buffer ? Buffer.from(message.buffer) : null);
      });
    });
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`Zip sanitizer worker exited with code ${code}`)));
    });
  });
}

interface PreparedArtifact {
  path: string;
  trustedContent: boolean;
}

async function hasSafePublicArtifactContent(skillId: StoredJob['skillId'], filePath: string): Promise<boolean> {
  const extension = path.extname(filePath).toLowerCase();
  if (skillId === 'export-kkres-image') return extension === '.kkres';
  if (extension !== '.zip') return true;
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_PUBLIC_ZIP_ARTIFACT_BYTES) return false;
  const scan = await zipEntryScan(filePath);
  return scan.valid && scan.entryNames.length > 0 && !scan.entryNames.some(hasUnsafeArchiveEntryName);
}

async function zipEntryScan(filePath: string): Promise<{ valid: boolean; entryNames: string[] }> {
  const buffer = await fs.readFile(filePath);
  return zipEntryScanFromBuffer(buffer);
}

function zipEntryScanFromBuffer(buffer: Buffer): { valid: boolean; entryNames: string[] } {
  const directory = zipCentralDirectoryInfo(buffer);
  if (!directory) return { valid: false, entryNames: [] };
  const names: string[] = [];
  let offset = 0;
  while (offset < directory.centralOffset) {
    if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return { valid: false, entryNames: names };
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + compressedSize;
    if (nameLength <= 0 || nameEnd > buffer.length || contentEnd > buffer.length || contentEnd > directory.centralOffset) return { valid: false, entryNames: names };
    names.push(buffer.subarray(nameStart, nameEnd).toString('utf8'));
    const text = zipEntryText(buffer.subarray(contentStart, contentEnd), compressionMethod, uncompressedSize);
    if (text === UNSAFE_ZIP_ENTRY_CONTENT || (text && hasUnsafePublicText(text))) names.push('../unsafe-content.txt');
    offset = contentEnd;
  }
  if (offset !== directory.centralOffset) return { valid: false, entryNames: names };
  for (let central = directory.centralOffset; central < directory.eocdOffset;) {
    if (central + 46 > buffer.length || buffer.readUInt32LE(central) !== 0x02014b50) return { valid: false, entryNames: names };
    const nameLength = buffer.readUInt16LE(central + 28);
    const extraLength = buffer.readUInt16LE(central + 30);
    const commentLength = buffer.readUInt16LE(central + 32);
    const nameStart = central + 46;
    const nameEnd = nameStart + nameLength;
    if (nameLength <= 0 || nameEnd > buffer.length) return { valid: false, entryNames: names };
    names.push(buffer.subarray(nameStart, nameEnd).toString('utf8'));
    central = nameEnd + extraLength + commentLength;
  }
  return { valid: names.length > 0, entryNames: names };
}

function zipCentralDirectoryInfo(buffer: Buffer): { centralOffset: number; eocdOffset: number } | null {
  for (let offset = Math.max(0, buffer.length - 65_557); offset + 22 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const centralOffset = buffer.readUInt32LE(offset + 16);
    return centralOffset <= offset ? { centralOffset, eocdOffset: offset } : null;
  }
  return null;
}


const UNSAFE_ZIP_ENTRY_CONTENT = '__unsafe_zip_entry_content__';

function zipEntryText(compressed: Buffer, method: number, uncompressedSize: number): string | null {
  try {
    if (uncompressedSize > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES) return UNSAFE_ZIP_ENTRY_CONTENT;
    if (method === 0) return compressed.toString('utf8');
    if (method === 8) return inflateRawSync(compressed, { maxOutputLength: MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES }).toString('utf8');
    return UNSAFE_ZIP_ENTRY_CONTENT;
  } catch (err) {
    console.error('zipEntryText decompression failed:', err instanceof Error ? err.message : String(err));
    return UNSAFE_ZIP_ENTRY_CONTENT;
  }
}

function hasUnsafeArchiveEntryName(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  return !normalized
    || normalized.includes('..')
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.startsWith('//')
    || /(?:^|[/])(?:stdout|stderr|debug|diagnostic|env|command)(?:[/._-]|$)/i.test(normalized)
    || /(?:\.exe|\.bat|\.cmd|\.ps1|\.sh|\.py|\.js)$/i.test(normalized);
}

function hasSensitivePublicText(value: string): boolean {
  if (!/[=]/.test(value) || !/(?:AGENT|Y3|VITE|TOKEN|SECRET|PASSWORD|API_KEY)/i.test(value)) return false;
  SENSITIVE_ENV_ASSIGNMENT_PATTERN.lastIndex = 0;
  return SENSITIVE_ENV_ASSIGNMENT_PATTERN.test(value);
}

function hasUnsafePublicText(value: string): boolean {
  return WINDOWS_PATH_PATTERN.test(value)
    || UNC_PATH_PATTERN.test(value)
    || POSIX_MOUNT_PATH_PATTERN.test(value)
    || /(?:^|[/])\.\.(?:[/]|$)/.test(value)
    || hasSensitivePublicText(value)
    || DANGEROUS_EXECUTABLE_TEXT_PATTERN.test(value);
}

function createJobId(): string {
  return `job-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function runCommand(command: RunnerCommand, maxChars: number, job: StoredJob, store: AgentJobStore): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    const pendingEvents: Promise<unknown>[] = [];
    try {
      child = spawn(command.command, command.args, {
        cwd: command.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      pendingEvents.push(store.recordEvent(job, 'agent-started', { message: 'Agent command 已启动' }, { updateState: false }));
    } catch (err) {
      reject(err);
      return;
    }

    let output = '';
    let finished = false;
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString();
      output = (output + text).slice(-maxChars);
      pendingEvents.push(store.recordEvent(job, 'agent-output', { stream, message: text }, { updateState: false }));
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGTERM');
      reject(new Error(`Agent job timed out after ${command.timeoutMs}ms`));
    }, command.timeoutMs);
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      void Promise.allSettled(pendingEvents).then(() => {
        if (code === 0) resolve({ output, exitCode: code ?? 0 });
        else reject(new Error(`Agent command exited with code ${code}. ${output}`.trim()));
      });
    });
  });
}

async function readManifest(outputDir: string): Promise<AgentResultManifest> {
  const manifestPath = path.join(outputDir, 'result-manifest.json');
  let parsed: unknown;
  try {
    const manifestText = await fs.readFile(manifestPath, 'utf8');
    parsed = JSON.parse(stripUtf8Bom(manifestText));
  } catch (err) {
    throw new Error(`Agent did not write valid result-manifest.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Agent manifest is not an object');
  const manifest = parsed as Partial<AgentResultManifest>;
  if (manifest.status !== 'succeeded' && manifest.status !== 'failed') throw new Error('Agent manifest status must be succeeded or failed');
  if (typeof manifest.summary !== 'string' || !manifest.summary.trim()) throw new Error('Agent manifest summary is required');
  return {
    status: manifest.status,
    summary: manifest.summary,
    artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts : [],
    verification: Array.isArray(manifest.verification) ? manifest.verification.map(String) : [],
    warnings: Array.isArray(manifest.warnings) ? manifest.warnings.map(String) : [],
  };
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

async function manifestArtifactPaths(outputDir: string, manifest: AgentResultManifest, discoverArtifacts: (outputDir: string) => Promise<string[]>, downloadableExtensions?: string[]): Promise<string[]> {
  const fromManifest: string[] = [];
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact || typeof artifact.path !== 'string') continue;
    fromManifest.push(path.isAbsolute(artifact.path) ? artifact.path : path.join(outputDir, artifact.path));
  }
  const discovered = await discoverArtifacts(outputDir);
  const combined = Array.from(new Set([...fromManifest, ...discovered]));
  if (!downloadableExtensions?.length) return combined;
  const allowed = new Set(downloadableExtensions.map((extension) => extension.toLowerCase()));
  return combined.filter((file) => allowed.has(path.extname(file).toLowerCase()));
}


async function restorePublicArtifacts(job: StoredJob): Promise<InternalArtifact[]> {
  const contract = AGENT_SKILL_CONTRACTS[job.skillId];
  const manifest = await readManifest(job.outputDir).catch(() => null);
  if (!manifest || manifest.status !== 'succeeded') return job.artifacts;
  const artifactPaths = await manifestArtifactPaths(job.outputDir, manifest, contract.discoverArtifacts, contract.downloadableExtensions).catch(() => []);
  if (artifactPaths.length === 0) return job.artifacts;
  return buildArtifacts(job, artifactPaths);
}

async function buildArtifacts(job: StoredJob, files: string[]): Promise<InternalArtifact[]> {
  const artifacts: InternalArtifact[] = [];
  for (const file of files) {
    const safe = await resolveUnder(job.outputDir, file);
    if (!safe) continue;
    const stat = await fs.stat(safe);
    if (!stat.isFile()) continue;
    const prepared = await preparePublicArtifact(job.skillId, safe, job.outputDir);
    if (!prepared) continue;
    const publicStat = await fs.stat(prepared.path);
    const relativePath = path.relative(job.outputDir, prepared.path);
    const candidate: InternalArtifact = {
      id: `artifact-${artifacts.length + 1}`,
      relativePath,
      name: path.basename(safe),
      sizeBytes: publicStat.size,
      downloadUrl: `/api/jobs/${encodeURIComponent(job.id)}/artifacts/artifact-${artifacts.length + 1}`,
    };
    if (!isSafePublicArtifact(job.skillId, candidate) || (!prepared.trustedContent && !await hasSafePublicArtifactContent(job.skillId, prepared.path))) continue;
    const id = candidate.id;
    artifacts.push({ ...candidate, id, downloadUrl: `/api/jobs/${encodeURIComponent(job.id)}/artifacts/${encodeURIComponent(id)}` });
    if (job.skillId === 'fetch-archive-changes' || job.skillId === 'fetch-mismatch-logs') break;
  }
  return artifacts;
}

function summarizeSuccess(manifest: AgentResultManifest, output: string, artifactCount: number): string {
  const sentences = [
    ensureSentence(manifest.summary),
    artifactCount > 0 ? `生成 ${artifactCount} 个附件。` : '未发现附件。',
  ];
  if (manifest.verification?.length) {
    sentences.push(`验证：${manifest.verification.slice(0, 2).join('；')}。`);
  } else {
    const fallback = output.trim().slice(0, 200);
    if (fallback) sentences.push(ensureSentence(fallback));
  }
  return redactPublicText(sentences.join('\n'));
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

async function resolveUnder(root: string, target: string): Promise<string | null> {
  const realRoot = await fs.realpath(root);
  let realTarget: string;
  try {
    realTarget = await fs.realpath(target);
  } catch {
    return null;
  }
  const relative = path.relative(realRoot, realTarget);
  return relative && (relative.startsWith('..') || path.isAbsolute(relative)) ? null : realTarget;
}

function publicEvent(event: AgentJobEvent): AgentJobEvent {
  const { raw: _raw, ...safeEvent } = event;
  void _raw;
  if (event.type === 'agent-output') {
    return { ...safeEvent, message: 'Raw agent output hidden from public event API' };
  }
  return { ...safeEvent, message: redactPublicText(event.message) };
}

async function appendEvent(outputDir: string, input: Omit<AgentJobEvent, 'id' | 'createdAt'>): Promise<AgentJobEvent> {
  await fs.mkdir(outputDir, { recursive: true });
  const previous = await readEventFile(outputDir);
  const event = { ...input, id: previous.length ? Math.max(...previous.map((item) => item.id)) + 1 : 1, createdAt: new Date().toISOString() } as AgentJobEvent;
  const envelope: EventEnvelope = { version: EVENT_LOG_VERSION, event };
  await fs.appendFile(path.join(outputDir, EVENTS_FILE), `${JSON.stringify(envelope)}\n`, 'utf8');
  return event;
}

async function readEventFile(outputDir: string): Promise<AgentJobEvent[]> {
  const filePath = path.join(outputDir, EVENTS_FILE);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const events: AgentJobEvent[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<EventEnvelope>;
      if (parsed.version !== EVENT_LOG_VERSION || !parsed.event || typeof parsed.event.id !== 'number') continue;
      events.push(parsed.event);
    } catch {
      continue;
    }
  }
  return events.sort((a, b) => a.id - b.id);
}

async function readJobState(outputDir: string): Promise<PersistedJobState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(outputDir, STATE_FILE), 'utf8')) as Partial<PersistedJobState>;
    if (parsed.version !== JOB_STATE_VERSION || !parsed.job || typeof parsed.job.id !== 'string') return null;
    parsed.job.safeResume = parsed.job.safeResume === true;
    parsed.job.progressOffset = Number.isFinite(parsed.job.progressOffset) ? parsed.job.progressOffset : 0;
    parsed.job.artifacts = Array.isArray(parsed.job.artifacts) ? parsed.job.artifacts : [];
    if (typeof parsed.job.ownerToken !== 'string' || !parsed.job.ownerToken.trim()) return null;
    parsed.job.ownerToken = parsed.job.ownerToken.trim();
    return parsed as PersistedJobState;
  } catch {
    return null;
  }
}


function parseProgressLine(line: string): Omit<AgentJobEvent, 'id' | 'jobId' | 'type' | 'createdAt'> {
  try {
    const parsed = JSON.parse(line) as { message?: unknown; progress?: unknown };
    const message = typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message : line.slice(0, 500);
    const progress = typeof parsed.progress === 'number' && Number.isFinite(parsed.progress) ? Math.max(0, Math.min(1, parsed.progress)) : undefined;
    return progress === undefined ? { message, raw: parsed } : { message, progress, raw: parsed };
  } catch {
    return { message: line.slice(0, 500), raw: line };
  }
}
