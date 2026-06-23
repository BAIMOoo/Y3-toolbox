import { describe, expect, it, vi } from 'vitest';
import { getAgentQueueStatus, getAgentRunnerStatus, hasActiveAgentJobs, isTerminalAgentJob, refreshActiveAgentJobs } from './agentJobCenterStatus';
import type { AgentHealthResponse, AgentJobSummary } from './types';

const baseHealth: AgentHealthResponse = {
  ready: false,
  trustedOnly: true,
  warning: 'trusted',
  queue: {
    running: 0,
    queued: 0,
    maxRunning: 2,
    maxQueued: 5,
    submissionsDisabled: false,
  },
  skills: [{ skillId: 'fetch-mismatch-logs', label: '拉取不同步日志' }],
};

describe('agent task service status view', () => {
  it('reports an in-progress connection while initial health is loading', () => {
    expect(getAgentRunnerStatus(null, { loading: true })).toEqual({ label: '正在连接任务服务', color: 'processing' });
  });

  it('reports unavailable when health has not loaded', () => {
    expect(getAgentRunnerStatus(null)).toEqual({ label: '任务服务未连接', color: 'error' });
  });

  it('prioritizes maintenance over aggregate readiness', () => {
    expect(getAgentRunnerStatus({
      ...baseHealth,
      ready: true,
      queue: { ...baseHealth.queue, submissionsDisabled: true },
    })).toEqual({ label: '任务服务维护中', color: 'error' });
  });

  it('reports ready when aggregate health is ready', () => {
    expect(getAgentRunnerStatus({ ...baseHealth, ready: true })).toEqual({ label: '任务服务可用', color: 'success' });
  });

  it('reports partial readiness when public health is reachable but aggregate readiness is false', () => {
    expect(getAgentRunnerStatus(baseHealth)).toEqual({ label: '任务服务部分可用', color: 'warning' });
  });

  it('reports not ready when no public skills are available', () => {
    expect(getAgentRunnerStatus({ ...baseHealth, skills: [] })).toEqual({ label: '任务服务未就绪', color: 'error' });
  });
});


describe('agent queue status view', () => {
  it('reports queue sync while initial health is loading', () => {
    expect(getAgentQueueStatus(null, { loading: true })).toEqual({
      label: '正在同步队列状态',
      color: 'warning',
      title: '正在等待任务服务首次响应',
    });
  });

  it('summarizes queue counts for the sticky topbar', () => {
    expect(getAgentQueueStatus({
      ...baseHealth,
      ready: true,
      queue: { ...baseHealth.queue, running: 1, queued: 2, maxRunning: 3, maxQueued: 8 },
    })).toEqual({ label: '运行 1/3 · 等待 2/8', color: 'success', title: '队列可提交' });
  });

  it('surfaces disabled submissions as maintenance copy', () => {
    expect(getAgentQueueStatus({
      ...baseHealth,
      queue: { ...baseHealth.queue, running: 1, queued: 4, submissionsDisabled: true },
    })).toEqual({ label: '暂停提交 · 运行 1/2 · 等待 4/5', color: 'error', title: '任务服务正在维护，暂不接受新任务' });
  });

  it('warns when queue capacity is full', () => {
    expect(getAgentQueueStatus({
      ...baseHealth,
      queue: { ...baseHealth.queue, queued: 5 },
    })).toEqual({ label: '运行 0/2 · 等待 5/5', color: 'warning', title: '队列接近或达到上限，新任务可能需要等待' });
  });
});

describe('active agent job detection', () => {
  it('returns false when all jobs are terminal', () => {
    expect(hasActiveAgentJobs([
      job('succeeded'),
      job('failed'),
    ])).toBe(false);
  });

  it('returns true when any job is queued or running', () => {
    expect(hasActiveAgentJobs([
      job('succeeded'),
      job('queued'),
    ])).toBe(true);
    expect(hasActiveAgentJobs([
      job('running'),
      job('failed'),
    ])).toBe(true);
  });

  it('exposes a terminal predicate for event polling', () => {
    expect(isTerminalAgentJob(job('succeeded'))).toBe(true);
    expect(isTerminalAgentJob(job('running'))).toBe(false);
  });
});

describe('active job refresh orchestration', () => {
  it('refreshes only active jobs and returns sorted updates', async () => {
    const active = fullJob('job-active', 'running', '2026-06-11T03:00:00.000Z');
    const terminal = fullJob('job-done', 'succeeded', '2026-06-11T02:00:00.000Z');
    const refreshed = { ...active, status: 'succeeded' as const, updatedAt: '2026-06-11T03:01:00.000Z' };
    const fetchJob = vi.fn().mockResolvedValue(refreshed);

    await expect(refreshActiveAgentJobs([terminal, active], fetchJob)).resolves.toEqual([refreshed, terminal]);
    expect(fetchJob).toHaveBeenCalledWith('job-active');
    expect(fetchJob).toHaveBeenCalledTimes(1);
  });

  it('does not own health refresh side effects, so job updates are not discarded by secondary health failures', async () => {
    const active = fullJob('job-active', 'running', '2026-06-11T03:00:00.000Z');
    const refreshed = { ...active, status: 'succeeded' as const, updatedAt: '2026-06-11T03:01:00.000Z' };
    const fetchJob = vi.fn().mockResolvedValue(refreshed);

    await expect(refreshActiveAgentJobs([active], fetchJob)).resolves.toEqual([refreshed]);
  });
});

function job(status: AgentJobSummary['status']): Pick<AgentJobSummary, 'status'> {
  return { status };
}

function fullJob(id: string, status: AgentJobSummary['status'], createdAt: string): AgentJobSummary {
  return {
    id,
    skillId: 'fetch-mismatch-logs',
    skillLabel: '拉取不同步日志',
    status,
    summary: status,
    createdAt,
    updatedAt: createdAt,
    artifacts: [],
  };
}
