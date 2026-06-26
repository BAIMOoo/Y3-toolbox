// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as recoveryExport from '../recoveryExport';
import * as recoveryInference from '../recoveryInference';
import { clearRecoveryPanelCacheForTests, RecoveryPanel } from '../RecoveryPanel';
import type { ArchiveChange, TimePoint } from '../../types';
import type { RecoveryInferenceResult } from '../recoveryInference';

afterEach(() => {
  clearRecoveryPanelCacheForTests();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function change(key: string, oldValue: string, newValue: string): ArchiveChange {
  const keyParts = key.split('-');
  return {
    key,
    keyParts,
    rootKey: keyParts[0],
    oldValue,
    newValue,
    changeType: oldValue === 'nil' ? 'create' : newValue === 'nil' ? 'delete' : 'update',
  };
}

function localValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function installDownloadMocks() {
  const click = vi.fn();
  const remove = vi.fn();
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === 'a') {
      Object.defineProperty(element, 'click', { configurable: true, value: click });
      Object.defineProperty(element, 'remove', { configurable: true, value: remove });
    }
    return element;
  });
  const createObjectURL = vi.fn(() => 'blob:recovery-download');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  return { click, remove, createObjectURL, revokeObjectURL };
}


async function waitForRecoveryPreview(text?: string) {
  if (text) {
    await screen.findByText(text);
    return;
  }
  await screen.findByRole('tree', { name: '回退 JSON 树预览' });
}

async function waitForExportEnabled(label: '导出 CSV' | '导出 JSON') {
  await waitFor(() => expect(screen.getByRole('button', { name: label })).toHaveProperty('disabled', false));
}

const timePoints: TimePoint[] = [
  {
    index: 0,
    timestamp: new Date('2026-03-20T10:05:00Z'),
    changes: [change('74-20007-物品数量', '100', '50')],
  },
];

describe('RecoveryPanel', () => {
  it('renders a compact entry without occupying the diff workspace by default', () => {
    const onOpen = vi.fn();
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints, selectedIndex: 0, view: 'entry', onOpen }));

    expect(screen.getByLabelText('存档回退入口')).toBeTruthy();
    expect(screen.getByRole('button', { name: '存档回退' })).toBeTruthy();
    expect(screen.queryByLabelText('存档回退输入生成')).toBeNull();
    expect(screen.queryByText(/玩家标识：player abc.csv/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '存档回退' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders safety copy and compact preview status in the recovery workspace', async () => {
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints, selectedIndex: 0, view: 'workspace' }));

    expect(screen.getByLabelText('存档回退输入生成')).toBeTruthy();
    expect(screen.getByText(/不写回存档/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('正在生成回退预览，完成前暂不可导出。');
    expect(screen.getByRole('button', { name: '导出 CSV' })).toHaveProperty('disabled', true);
    await screen.findByText(/当前预览展示 1 \/ 1 个槽位片段、1 \/ 1 个字段/);
  });

  it('keeps exports disabled while scheduled inference is loading, then enables them when ready', async () => {
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints, selectedIndex: 0, view: 'workspace' }));

    expect(screen.getByRole('status').textContent).toContain('正在生成回退预览，完成前暂不可导出。');
    expect(screen.getByText('正在生成回退预览…')).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toHaveProperty('disabled', true);

    await waitForRecoveryPreview();

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toHaveProperty('disabled', false);
  });

  it('ignores a stale scheduled inference after inputs change', async () => {
    vi.useFakeTimers();
    const firstPoints: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:05:00Z'), changes: [change('74-20007-物品数量', '100', '50')] },
    ];
    const nextPoints: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:06:00Z'), changes: [change('74-20008-物品数量', '10', '5')] },
    ];

    const { rerender } = render(React.createElement(RecoveryPanel, { fileName: 'first.csv', timePoints: firstPoints, selectedIndex: 0, view: 'workspace' }));
    rerender(React.createElement(RecoveryPanel, { fileName: 'next.csv', timePoints: nextPoints, selectedIndex: 0, view: 'workspace' }));

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.queryByRole('button', { name: '折叠 20007' })).toBeNull();
    expect(screen.getByRole('button', { name: '折叠 20008' })).toBeTruthy();
  });

  it('renders aid provenance when raw log metadata supplied an aid', async () => {
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', aid: '30344223', timePoints, selectedIndex: 0, view: 'workspace' }));

    await screen.findByText(/当前预览展示 1 \/ 1 个槽位片段、1 \/ 1 个字段/);
  });

  it('shows proven recovery fields as an expandable JSON-like tree', async () => {
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints, selectedIndex: 0, view: 'workspace' }));

    expect(screen.getByText(/V1 只输出日志能证明的字段/)).toBeTruthy();
    await waitForRecoveryPreview();

    expect(screen.getByRole('tree', { name: '回退 JSON 树预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '折叠 74' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '折叠 20007' })).toBeTruthy();
    expect(screen.getByText('物品数量')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('已证明')).toBeTruthy();
  });

  it('defaults to the imported log start so preview scans all loaded frames', async () => {
    const points: TimePoint[] = [
      timePoints[0],
      { index: 1, timestamp: new Date('2026-03-20T10:30:00Z'), changes: [change('74-20008-物品数量', '10', '5')] },
    ];
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints: points, selectedIndex: 1, view: 'workspace' }));

    expect(screen.getByLabelText('回退起点')).toHaveProperty('value', localValue(points[0].timestamp));
    await waitForRecoveryPreview();
    expect(screen.getByRole('button', { name: '折叠 20008' })).toBeTruthy();
  });


  it('does not reschedule recovery inference on timeline selection changes until the user opts into current time', async () => {
    vi.useFakeTimers();
    const points: TimePoint[] = [
      timePoints[0],
      { index: 1, timestamp: new Date('2026-03-20T10:30:00Z'), changes: [change('74-20008-物品数量', '10', '5')] },
    ];

    const { rerender } = render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints: points, selectedIndex: 0, view: 'workspace' }));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByRole('button', { name: '折叠 20007' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '折叠 20008' })).toBeTruthy();

    rerender(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints: points, selectedIndex: 1, view: 'workspace' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '折叠 20007' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '折叠 20008' })).toBeTruthy();
  });

  it('uses the current selected frame only after clicking use current time', async () => {
    const points: TimePoint[] = [
      timePoints[0],
      { index: 1, timestamp: new Date('2026-03-20T10:30:00Z'), changes: [change('74-20008-物品数量', '10', '5')] },
    ];
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints: points, selectedIndex: 1, view: 'workspace' }));

    fireEvent.click(screen.getByRole('button', { name: '用时间轴所处时间' }));

    expect(screen.getByLabelText('回退起点')).toHaveProperty('value', localValue(points[1].timestamp));
    await screen.findByRole('button', { name: '折叠 20008' });
    expect(screen.queryByRole('button', { name: '折叠 20007' })).toBeNull();
  });



  it('shows a bounded preview first and reveals more fields on demand', async () => {
    const manyPoints: TimePoint[] = Array.from({ length: 510 }, (_, index) => ({
      index,
      timestamp: new Date(Date.UTC(2026, 2, 20, 10, index, 0)),
      changes: [change(`74-${20000 + index}-物品数量`, String(100 + index), String(50 + index))],
    }));

    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints: manyPoints, selectedIndex: 0, view: 'workspace' }));

    expect(await screen.findByText(/当前预览展示 500 \/ 510 个槽位片段、500 \/ 510 个字段/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /显示更多回退字段/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '折叠 20499' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '折叠 20509' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /显示更多回退字段/ }));

    expect(await screen.findByText(/当前预览展示 510 \/ 510 个槽位片段、510 \/ 510 个字段/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '折叠 20509' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /显示更多回退字段/ })).toBeNull();
  }, 20000);

  it('reuses cached recovery immediately when remounted with the same in-memory request', async () => {
    vi.useFakeTimers();
    const points: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:05:00Z'), changes: [change('74-30001-物品数量', '100', '50')] },
    ];
    const inferSpy = vi.spyOn(recoveryInference, 'inferRecoveryFragments');

    const first = render(React.createElement(RecoveryPanel, { fileName: 'cache.csv', timePoints: points, selectedIndex: 0, view: 'workspace' }));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByRole('button', { name: '折叠 30001' })).toBeTruthy();
    expect(inferSpy).toHaveBeenCalledTimes(1);
    first.unmount();

    render(React.createElement(RecoveryPanel, { fileName: 'cache.csv', timePoints: points, selectedIndex: 0, view: 'workspace' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '折叠 30001' })).toBeTruthy();
    expect(inferSpy).toHaveBeenCalledTimes(1);
  });

  it('does not show stale scheduled recovery during a same-mounted timePoints replacement with the same request key', async () => {
    vi.useFakeTimers();
    const firstPoints: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:05:00Z'), changes: [change('74-34001-物品数量', '100', '50')] },
    ];
    const nextPoints: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:05:00Z'), changes: [change('74-34002-物品数量', '100', '50')] },
    ];

    const { rerender } = render(React.createElement(RecoveryPanel, { fileName: 'same-key.csv', timePoints: firstPoints, selectedIndex: 0, view: 'workspace' }));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByRole('button', { name: '折叠 34001' })).toBeTruthy();

    rerender(React.createElement(RecoveryPanel, { fileName: 'same-key.csv', timePoints: nextPoints, selectedIndex: 0, view: 'workspace' }));

    expect(screen.queryByRole('button', { name: '折叠 34001' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('正在生成回退预览，完成前暂不可导出。');
    expect(screen.getByRole('button', { name: '导出 JSON' })).toHaveProperty('disabled', true);

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.queryByRole('button', { name: '折叠 34001' })).toBeNull();
    expect(screen.getByRole('button', { name: '折叠 34002' })).toBeTruthy();
  });

  it('does not reuse cached recovery for a different timePoints array with similar surface stats', async () => {
    vi.useFakeTimers();
    const firstPoints: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:05:00Z'), changes: [change('74-30002-物品数量', '100', '50')] },
    ];
    const nextPoints: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:05:00Z'), changes: [change('74-30003-物品数量', '100', '50')] },
    ];
    const inferSpy = vi.spyOn(recoveryInference, 'inferRecoveryFragments');

    const first = render(React.createElement(RecoveryPanel, { fileName: 'array.csv', timePoints: firstPoints, selectedIndex: 0, view: 'workspace' }));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByRole('button', { name: '折叠 30002' })).toBeTruthy();
    first.unmount();

    render(React.createElement(RecoveryPanel, { fileName: 'array.csv', timePoints: nextPoints, selectedIndex: 0, view: 'workspace' }));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.queryByRole('button', { name: '折叠 30002' })).toBeNull();
    expect(screen.getByRole('button', { name: '折叠 30003' })).toBeTruthy();
    expect(inferSpy).toHaveBeenCalledTimes(2);
  });

  it('resets the visible preview budget when the recovery request changes', async () => {
    const manyPoints: TimePoint[] = Array.from({ length: 510 }, (_, index) => ({
      index,
      timestamp: new Date(Date.UTC(2026, 2, 20, 10, index, 0)),
      changes: [change(`74-${31000 + index}-物品数量`, String(100 + index), String(50 + index))],
    }));

    render(React.createElement(RecoveryPanel, { fileName: 'budget.csv', timePoints: manyPoints, selectedIndex: 509, view: 'workspace' }));
    expect(await screen.findByText(/500 \/ 510 个字段/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /显示更多回退字段/ }));
    expect(await screen.findByText(/510 \/ 510 个字段/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '用时间轴所处时间' }));

    expect(await screen.findByText(/1 \/ 1 个字段/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /显示更多回退字段/ })).toBeNull();
  }, 20000);

  it('keeps full export data when the visible preview is capped', async () => {
    const downloadMocks = installDownloadMocks();
    const captured: RecoveryInferenceResult[] = [];
    vi.spyOn(recoveryExport, 'serializeRecoveryJson').mockImplementation((result) => {
      captured.push(result);
      return JSON.stringify(result);
    });
    const manyPoints: TimePoint[] = Array.from({ length: 510 }, (_, index) => ({
      index,
      timestamp: new Date(Date.UTC(2026, 2, 20, 10, index, 0)),
      changes: [change(`74-${32000 + index}-物品数量`, String(100 + index), String(50 + index))],
    }));

    render(React.createElement(RecoveryPanel, { fileName: 'full-export.csv', timePoints: manyPoints, selectedIndex: 0, view: 'workspace' }));
    await screen.findByText(/500 \/ 510 个字段/);
    expect(screen.queryByRole('button', { name: '折叠 32509' })).toBeNull();
    await waitForExportEnabled('导出 JSON');
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));

    expect(captured[0]?.fields).toHaveLength(510);
    expect(captured[0]?.fields.some((field) => field.key === '74-32509-物品数量')).toBe(true);
    expect(downloadMocks.click).toHaveBeenCalledTimes(1);
  }, 20000);

  it('uses warmed cache without loading flicker under React StrictMode remounts', async () => {
    vi.useFakeTimers();
    const points: TimePoint[] = [
      { index: 0, timestamp: new Date('2026-03-20T10:05:00Z'), changes: [change('74-33001-物品数量', '100', '50')] },
    ];
    const inferSpy = vi.spyOn(recoveryInference, 'inferRecoveryFragments');

    const first = render(React.createElement(React.StrictMode, null, React.createElement(RecoveryPanel, { fileName: 'strict.csv', timePoints: points, selectedIndex: 0, view: 'workspace' })));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByRole('button', { name: '折叠 33001' })).toBeTruthy();
    const warmCallCount = inferSpy.mock.calls.length;
    expect(warmCallCount).toBeGreaterThan(0);
    first.unmount();

    render(React.createElement(React.StrictMode, null, React.createElement(RecoveryPanel, { fileName: 'strict.csv', timePoints: points, selectedIndex: 0, view: 'workspace' })));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '折叠 33001' })).toBeTruthy();
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(inferSpy).toHaveBeenCalledTimes(warmCallCount);
  }, 20000);

  it('uses the optional end time to filter the preview window', async () => {
    const points: TimePoint[] = [
      timePoints[0],
      { index: 1, timestamp: new Date('2026-03-20T10:30:00Z'), changes: [change('74-20008-物品数量', '10', '5')] },
    ];
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints: points, selectedIndex: 0, view: 'workspace' }));
    fireEvent.click(screen.getByLabelText('启用结束时间'));
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: localValue(points[0].timestamp) } });

    await waitForRecoveryPreview();
    expect(screen.queryByRole('button', { name: '折叠 20008' })).toBeNull();
  });

  it('collapses and expands recovery preview tree branches without losing values', async () => {
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints, selectedIndex: 0, view: 'workspace' }));

    await waitForRecoveryPreview('物品数量');
    fireEvent.click(screen.getByRole('button', { name: '折叠 74' }));

    expect(screen.queryByText('物品数量')).toBeNull();
    expect(screen.queryByText('100')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开 74' }));

    expect(screen.getByText('物品数量')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
  });

  it('blocks mixed-aid recovery export to avoid player misattribution', () => {
    render(React.createElement(RecoveryPanel, {
      fileName: 'mixed.csv',
      aidConflict: ['30344223', '30344224'],
      timePoints,
      selectedIndex: 0,
      view: 'workspace',
    }));

    expect(screen.getByText(/检测到多个日志 aid/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '导出 JSON' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/V1 不支持混合玩家导出/)).toBeTruthy();
  });

  it('exports JSON with aid provenance and no-write-back marker', async () => {
    const downloadMocks = installDownloadMocks();
    const captured: RecoveryInferenceResult[] = [];
    vi.spyOn(recoveryExport, 'serializeRecoveryJson').mockImplementation((result) => {
      captured.push(result);
      return JSON.stringify(result);
    });

    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', aid: '30344223', timePoints, selectedIndex: 0, view: 'workspace' }));
    await waitForExportEnabled('导出 JSON');
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));

    expect(captured[0]?.identity).toMatchObject({ playerId: '30344223', playerIdentifierSource: 'aid-from-log' });
    expect(captured[0]?.writeBackSupported).toBe(false);
    expect(downloadMocks.click).toHaveBeenCalledTimes(1);
    expect(downloadMocks.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadMocks.revokeObjectURL).toHaveBeenCalledWith('blob:recovery-download');
  });

  it('exports CSV through the recovery serializer', async () => {
    const downloadMocks = installDownloadMocks();
    const serializeCsv = vi.spyOn(recoveryExport, 'serializeRecoveryCsv').mockReturnValue('playerIdentifierSource\naid-from-log\n');

    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', aid: '30344223', timePoints, selectedIndex: 0, view: 'workspace' }));
    await waitForExportEnabled('导出 CSV');
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));

    expect(serializeCsv).toHaveBeenCalledTimes(1);
    expect(downloadMocks.click).toHaveBeenCalledTimes(1);
  });

  it('omits the return action because the toolbar owns recovery mode switching', () => {
    render(React.createElement(RecoveryPanel, { fileName: 'player abc.csv', timePoints, selectedIndex: 0, view: 'workspace' }));

    expect(screen.queryByRole('button', { name: '返回变动对比' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看存档变动' })).toBeNull();
  });

  it('does not render without diff data', () => {
    const { container } = render(React.createElement(RecoveryPanel, { fileName: null, timePoints: [], selectedIndex: 0 }));
    expect(container.textContent).toBe('');
  });
});
