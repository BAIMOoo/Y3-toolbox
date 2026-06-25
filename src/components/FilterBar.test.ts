// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import type { FilterState } from '../types';

vi.mock('antd', () => {
  const MockSelect = ({ placeholder, children }: { placeholder?: string; children?: React.ReactNode }) => (
    React.createElement('select', { 'aria-label': placeholder }, children)
  );
  MockSelect.Option = ({ value, children }: { value?: string; children?: React.ReactNode }) => (
    React.createElement('option', { value }, children)
  );

  return {
    DatePicker: {
      RangePicker: () => React.createElement('input', { 'aria-label': '时间范围' }),
    },
    Input: ({ placeholder, onChange }: { placeholder?: string; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => (
      React.createElement('input', { 'aria-label': placeholder, placeholder, onChange })
    ),
    Select: MockSelect,
    Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@ant-design/icons', () => ({
  SearchOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }),
  DownloadOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'download'),
}));

vi.mock('./FileUpload', () => ({
  FileUpload: () => React.createElement('button', { type: 'button', 'aria-label': '导入 CSV' }, '导入 CSV'),
}));

afterEach(() => {
  cleanup();
});

const emptyFilter: FilterState = {
  searchKeyword: '',
  changeTypes: [],
  rootKeys: [],
  timeRange: null,
};

function renderFilterBar(overrides: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  const props: React.ComponentProps<typeof FilterBar> = {
    filter: emptyFilter,
    onFilterChange: vi.fn(),
    availableRootKeys: [],
    onFileSelected: vi.fn(),
    loading: false,
    fileName: 'player.csv',
    onDownloadClean: vi.fn(),
    onOpenRecovery: vi.fn(),
    ...overrides,
  };
  render(React.createElement(FilterBar, props));
  return props;
}

describe('FilterBar recovery action', () => {
  it('places 存档回退 immediately before the clean CSV download action', () => {
    renderFilterBar();

    const actions = document.querySelector('.diff-context-toolbar__actions');
    expect(actions).toBeTruthy();
    const buttons = within(actions as HTMLElement).getAllByRole('button');
    const names = buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim());

    expect(names).toContain('存档回退');
    expect(names.indexOf('存档回退')).toBe(names.indexOf('下载整理后的 CSV') - 1);
  });

  it('opens the recovery workspace from the toolbar button', () => {
    const props = renderFilterBar();

    fireEvent.click(screen.getByRole('button', { name: '存档回退' }));

    expect(props.onOpenRecovery).toHaveBeenCalledTimes(1);
  });

  it('disables 存档回退 when no file is loaded', () => {
    renderFilterBar({ fileName: null });

    expect(screen.getByRole('button', { name: '存档回退' })).toHaveProperty('disabled', true);
  });
});
