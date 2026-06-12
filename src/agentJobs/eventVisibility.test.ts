import { describe, expect, it } from 'vitest';
import { filterUserVisibleJobEvents, isUserVisibleJobEvent } from './eventVisibility';
import type { AgentJobEvent } from './types';

const baseEvent = {
  id: 1,
  jobId: 'job-1',
  createdAt: '2026-06-10T03:00:00.000Z',
} satisfies Pick<AgentJobEvent, 'id' | 'jobId' | 'createdAt'>;

describe('agent job event visibility', () => {
  it('hides all raw agent-output events regardless of stdout or stderr stream', () => {
    expect(isUserVisibleJobEvent({ ...baseEvent, type: 'agent-output', stream: 'stdout', message: 'raw stdout' })).toBe(false);
    expect(isUserVisibleJobEvent({ ...baseEvent, type: 'agent-output', stream: 'stderr', message: 'raw stderr' })).toBe(false);
  });

  it('keeps structured progress and failure events visible', () => {
    const events: AgentJobEvent[] = [
      { ...baseEvent, id: 1, type: 'queued', message: 'queued' },
      { ...baseEvent, id: 2, type: 'progress', message: 'structured progress' },
      { ...baseEvent, id: 3, type: 'agent-output', stream: 'stderr', message: 'raw stderr should be hidden' },
      { ...baseEvent, id: 4, type: 'failed', message: 'failure summary remains visible' },
    ];

    expect(filterUserVisibleJobEvents(events).map((event) => event.message)).toEqual([
      'queued',
      'structured progress',
      'failure summary remains visible',
    ]);
  });
});
