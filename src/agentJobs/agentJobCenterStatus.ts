import type { AgentCompatibilityResult } from './agentCompatibility';
import type { AgentHealthResponse, AgentJobSummary } from './types';

/**
 * 只有排队中和执行中算“进行中”。判定写成反选而不是终态白名单：任务服务将来新增任何状态时，
 * 已发布的旧客户端也只会把它当成已结束，而不是把未知状态当成未完成、无限轮询。
 */
const ACTIVE_JOB_STATUSES = new Set<string>(['queued', 'running']);

export type AgentJobStatusTone = 'success' | 'warning' | 'error' | 'processing' | 'default';

export interface AgentJobStatusView {
  label: string;
  color: AgentJobStatusTone;
}

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
  return !ACTIVE_JOB_STATUSES.has(job.status);
}

/**
 * 取消是终态 failed 上的一个标记：公开接口不暴露 cancelled 状态值，这样还没升级的客户端
 * 遇到取消过的任务时不会在状态映射上崩溃。
 */
export function isCancelledAgentJob(job: Pick<AgentJobSummary, 'cancelledAt'>): boolean {
  return Boolean(job.cancelledAt);
}

export function canCancelAgentJob(job: Pick<AgentJobSummary, 'status'>): boolean {
  return ACTIVE_JOB_STATUSES.has(job.status);
}

export function getAgentJobStatusView(job: Pick<AgentJobSummary, 'status' | 'cancelledAt'>): AgentJobStatusView {
  if (isCancelledAgentJob(job)) return { label: '已取消', color: 'warning' };
  switch (job.status) {
    case 'queued':
      return { label: '等待', color: 'warning' };
    case 'running':
      return { label: '执行中', color: 'processing' };
    case 'succeeded':
      return { label: '成功', color: 'success' };
    case 'failed':
      return { label: '失败', color: 'error' };
    default:
      // 未知状态按“已结束”渲染，绝不因为不认识它而抛错。
      return { label: String(job.status ?? '未知状态'), color: 'default' };
  }
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
