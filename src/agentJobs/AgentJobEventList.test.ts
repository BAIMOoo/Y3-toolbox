import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AgentJobEventList } from './AgentJobEventList';
import type { AgentJobEvent } from './types';


vi.mock('antd', () => ({
  Tag: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
}));

const baseEvent = {
  jobId: 'job-1',
  createdAt: '2026-06-10T03:00:00.000Z',
} satisfies Pick<AgentJobEvent, 'jobId' | 'createdAt'>;

describe('AgentJobEventList', () => {
  it('does not render raw agent-output messages in the default log UI', () => {
    const events: AgentJobEvent[] = [
      { ...baseEvent, id: 1, type: 'progress', message: 'structured progress visible' },
      { ...baseEvent, id: 2, type: 'agent-output', stream: 'stdout', message: 'raw stdout hidden' },
      { ...baseEvent, id: 3, type: 'agent-output', stream: 'stderr', message: 'raw stderr hidden' },
      { ...baseEvent, id: 4, type: 'failed', message: 'structured failure visible' },
    ];

    const html = renderToStaticMarkup(React.createElement(AgentJobEventList, { events, emptyMessage: 'empty' }));

    expect(html).toContain('structured progress visible');
    expect(html).toContain('structured failure visible');
    expect(html).not.toContain('raw stdout hidden');
    expect(html).not.toContain('raw stderr hidden');
  });

  it('shows the empty message when only hidden raw output exists', () => {
    const events: AgentJobEvent[] = [
      { ...baseEvent, id: 1, type: 'agent-output', stream: 'stdout', message: 'raw stdout hidden' },
    ];

    const html = renderToStaticMarkup(React.createElement(AgentJobEventList, { events, emptyMessage: '暂无可见进度事件' }));

    expect(html).toContain('暂无可见进度事件');
    expect(html).not.toContain('raw stdout hidden');
  });
});
