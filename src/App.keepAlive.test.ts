// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TimePoint } from './types';

const loadFile = vi.fn();
const loadFromText = vi.fn();
const setFilter = vi.fn();
const setSelectedIndex = vi.fn();
const goToPrev = vi.fn();
const goToNext = vi.fn();
const goToFirst = vi.fn();
const goToLast = vi.fn();
const downloadCleanCsv = vi.fn();
const timelineMounts = vi.fn();

const loadedTimePoints: TimePoint[] = [
  { index: 0, timestamp: new Date('2026-03-20T10:00:00'), changes: [{ key: '100-1', keyParts: ['100', '1'], rootKey: '100', oldValue: 'nil', newValue: '1', changeType: 'create' }] },
  { index: 1, timestamp: new Date('2026-03-20T10:01:00'), changes: [{ key: '100-2', keyParts: ['100', '2'], rootKey: '100', oldValue: '1', newValue: '2', changeType: 'update' }] },
  { index: 2, timestamp: new Date('2026-03-20T10:02:00'), changes: [{ key: '200-1', keyParts: ['200', '1'], rootKey: '200', oldValue: 'nil', newValue: '9', changeType: 'create' }] },
];

const loadedFilter = {
  timeRange: [new Date('2026-03-20T09:59:00'), new Date('2026-03-20T10:03:00')] as [Date, Date],
  rootKeys: ['100'],
  changeTypes: ['update' as const],
  searchKeyword: 'gold',
};

vi.mock('antd', () => ({
  ConfigProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Alert: ({ message }: { message: string }) => React.createElement('div', { role: 'alert' }, message),
  Segmented: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> }) => (
    React.createElement('div', { role: 'group', 'aria-label': 'segmented' }, options.map((option) => (
      React.createElement('button', {
        key: option.value,
        type: 'button',
        'aria-pressed': value === option.value,
        onClick: () => onChange(option.value),
      }, option.label)
    )))
  ),
  theme: { darkAlgorithm: {}, defaultAlgorithm: {} },
}));

vi.mock('@ant-design/icons', () => ({
  MoonOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'moon'),
  SunOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'sun'),
}));

vi.mock('./hooks/useArchiveData', () => ({
  useArchiveData: () => ({
    timePoints: loadedTimePoints,
    filteredTimePoints: loadedTimePoints,
    filteredIndexMap: new Map(loadedTimePoints.map((tp) => [tp.index, tp])),
    selectedIndex: 2,
    filter: loadedFilter,
    fileName: 'player.csv',
    recoveryAid: null,
    recoveryAidConflict: [],
    loading: false,
    error: null,
    availableRootKeys: ['100', '200'],
    snapshotEngine: {
      getSnapshotAt: (index: number) => (index < 0 ? {} : { 100: { 1: '1', 2: String(index) } }),
    },
    loadFile,
    loadFromText,
    setFilter,
    setSelectedIndex,
    goToPrev,
    goToNext,
    goToFirst,
    goToLast,
    downloadCleanCsv,
  }),
}));

vi.mock('./components/FilterBar', () => ({
  FilterBar: ({ filter, fileName }: { filter: typeof loadedFilter; fileName: string | null }) => (
    React.createElement('section', { 'data-testid': 'filter-bar' },
      React.createElement('span', null, fileName),
      React.createElement('span', { 'data-testid': 'filter-state' }, JSON.stringify({ rootKeys: filter.rootKeys, changeTypes: filter.changeTypes, searchKeyword: filter.searchKeyword, hasTimeRange: Boolean(filter.timeRange) })),
    )
  ),
}));

vi.mock('./components/Timeline', () => ({
  Timeline: ({ selectedIndex }: { selectedIndex: number }) => {
    useEffect(() => {
      timelineMounts();
    }, []);
    return React.createElement('div', { 'data-testid': 'timeline-sentinel' }, `selected:${selectedIndex}`);
  },
}));

vi.mock('./components/ChangeList', () => ({
  ChangeList: () => React.createElement('div', { 'data-testid': 'change-list' }, 'changes'),
}));

vi.mock('./components/SnapshotView', () => ({
  SnapshotView: () => React.createElement('div', { 'data-testid': 'snapshot-view' }, 'snapshot'),
}));

vi.mock('./components/ResizableSplit', () => ({
  ResizableSplit: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => React.createElement('div', { 'data-testid': 'resizable-split' }, left, right),
}));

vi.mock('./components/StatusBar', () => ({
  StatusBar: ({ fileName, selectedIndex }: { fileName: string | null; selectedIndex: number }) => React.createElement('div', { 'data-testid': 'status-bar' }, `${fileName}:${selectedIndex}`),
}));

vi.mock('./components/EmptyState', () => ({
  EmptyState: () => React.createElement('div', { 'data-testid': 'empty-state' }, 'empty'),
}));

vi.mock('./archiveViewer/LocalArchiveViewer', () => ({
  LocalArchiveViewer: () => React.createElement('section', { 'data-testid': 'local-archive-viewer' }, 'local archive'),
}));

vi.mock('./agentJobs/AgentJobCenter', () => ({
  AgentJobCenter: () => React.createElement('section', { 'data-testid': 'agent-job-center' }, 'agent jobs'),
}));

vi.mock('./recovery/RecoveryPanel', () => ({
  RecoveryPanel: () => React.createElement('section', { 'data-testid': 'recovery-panel' }, 'recovery'),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('App Change Log keep-alive behavior', () => {
  it('keeps loaded Change Log work position mounted and hidden, not remounted, across top-level module switches', async () => {
    const { default: App } = await import('./App');
    render(React.createElement(App));

    expect(screen.getByTestId('filter-bar').textContent).toContain('player.csv');
    expect(screen.getByTestId('timeline-sentinel').textContent).toContain('selected:2');
    expect(screen.getByTestId('filter-state').textContent).toContain('gold');
    expect(timelineMounts).toHaveBeenCalledTimes(1);
    const initialWorkspace = screen.getByTestId('diff-workspace');

    fireEvent.click(screen.getByRole('button', { name: '本地 Archive' }));

    expect(screen.getByTestId('local-archive-viewer')).toBeTruthy();
    const inactiveWorkspace = screen.getByTestId('diff-workspace');
    expect(inactiveWorkspace).toBe(initialWorkspace);
    expect(inactiveWorkspace.hasAttribute('hidden')).toBe(true);
    expect(inactiveWorkspace.querySelector('[data-testid="timeline-sentinel"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '变动日志' }));

    expect(screen.getByTestId('timeline-sentinel').textContent).toContain('selected:2');
    expect(screen.getByTestId('filter-state').textContent).toContain('gold');
    expect(screen.getByTestId('diff-workspace')).toBe(initialWorkspace);
    expect(timelineMounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Agent 任务' }));
    expect(screen.getByTestId('agent-job-center')).toBeTruthy();
    expect(screen.getByTestId('diff-workspace')).toBe(initialWorkspace);
    expect(screen.getByTestId('diff-workspace').hasAttribute('hidden')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '变动日志' }));

    expect(screen.getByTestId('timeline-sentinel').textContent).toContain('selected:2');
    expect(screen.getByTestId('filter-state').textContent).toContain('gold');
    expect(screen.getByTestId('diff-workspace')).toBe(initialWorkspace);
    expect(timelineMounts).toHaveBeenCalledTimes(1);
    expect(loadFile).not.toHaveBeenCalled();
    expect(loadFromText).not.toHaveBeenCalled();
  });
});
