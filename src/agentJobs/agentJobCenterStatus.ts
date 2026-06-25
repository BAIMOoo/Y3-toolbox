import type { AgentCompatibilityResult } from './agentCompatibility';
import type { AgentHealthResponse, AgentJobSummary } from './types';

const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed']);

export type AgentRunnerStatusTone = 'success' | 'warning' | 'error' | 'processing';
export type AgentQueueStatusTone = 'success' | 'warning' | 'error';

export interface AgentRunnerStatusView {
  label: string;
  color: AgentRunnerStatusTone;
}

export interface AgentQueueStatusView {
  label: string;
  color: AgentQueueStatusTone;
  title: string;
}

interface AgentStatusOptions {
  loading?: boolean;
  compatibility?: AgentCompatibilityResult;
}

export function getAgentRunnerStatus(health: AgentHealthResponse | null, options: AgentStatusOptions = {}): AgentRunnerStatusView {
  if (!health && options.loading) return { label: '正在连接任务服务', color: 'processing' };
  if (!health) return { label: '任务服务未连接', color: 'error' };
  if (health.queue.submissionsDisabled) return { label: '任务服务维护中', color: 'error' };
  if (options.compatibility?.submitBlocked) return { label: options.compatibility.statusLabel, color: 'error' };
  if (health.ready) return { label: '任务服务可用', color: 'success' };
  if (health.skills.length > 0) return { label: '任务服务部分可用', color: 'warning' };
  return { label: '任务服务未就绪', color: 'error' };
}

export function getAgentQueueStatus(health: AgentHealthResponse | null, options: AgentStatusOptions = {}): AgentQueueStatusView {
  if (!health && options.loading) return { label: '正在同步队列状态', color: 'warning', title: '正在等待任务服务首次响应' };
  if (!health) return { label: '队列状态未知', color: 'warning', title: '等待任务服务连接' };
  const { queue } = health;
  if (queue.submissionsDisabled) {
    return {
      label: `暂停提交 · 运行 ${queue.running}/${queue.maxRunning} · 等待 ${queue.queued}/${queue.maxQueued}`,
      color: 'error',
      title: '任务服务正在维护，暂不接受新任务',
    };
  }
  const isFull = queue.queued >= queue.maxQueued || queue.running >= queue.maxRunning;
  return {
    label: `运行 ${queue.running}/${queue.maxRunning} · 等待 ${queue.queued}/${queue.maxQueued}`,
    color: isFull ? 'warning' : 'success',
    title: isFull ? '队列接近或达到上限，新任务可能需要等待' : '队列可提交',
  };
}

export function isTerminalAgentJob(job: Pick<AgentJobSummary, 'status'>): boolean {
  return TERMINAL_JOB_STATUSES.has(job.status);
}

export function hasActiveAgentJobs(jobs: Pick<AgentJobSummary, 'status'>[]): boolean {
  return jobs.some((job) => !isTerminalAgentJob(job));
}

export async function refreshActiveAgentJobs(
  jobs: AgentJobSummary[],
  fetchJob: (jobId: string) => Promise<AgentJobSummary>,
): Promise<AgentJobSummary[]> {
  const updated = await Promise.all(jobs.map(async (job) => {
    if (isTerminalAgentJob(job)) return job;
    return fetchJob(job.id);
  }));
  return updated.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
