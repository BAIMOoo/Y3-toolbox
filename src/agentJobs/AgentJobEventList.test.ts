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

  it('renders event metadata above long messages so messages can use full row width', () => {
    const events: AgentJobEvent[] = [
      { ...baseEvent, id: 1, type: 'succeeded', message: '已成功导出 KKExport.kkres，可下载使用。 生成 1 个附件。 验证：已读取并执行 export-kkres-image 技能流程；已验证输入图片、运行时根目录、dm 仓库根目录和项目路径存在。' },
    ];

    const html = renderToStaticMarkup(React.createElement(AgentJobEventList, { events, emptyMessage: 'empty' }));

    expect(html).toContain('class="agent-job-event-meta"');
    expect(html).toContain('class="agent-job-event-tags"');
    expect(html).toContain('class="agent-job-event-message"');
    expect(html).toContain('验证：已读取并执行 export-kkres-image 技能流程');
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
