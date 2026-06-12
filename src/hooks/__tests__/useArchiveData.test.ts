// src/hooks/__tests__/useArchiveData.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useArchiveData, findNextIndex, findPrevIndex, findFirstIndex, findLastIndex, buildDownloadFileName } from '../useArchiveData';
import type { TimePoint } from '../../types';

const makeTPs = (indices: number[]): TimePoint[] =>
  indices.map(index => ({
    index,
    timestamp: new Date(2025, 0, 1, 0, index),
    changes: [{ key: `k${index}`, keyParts: [`k${index}`], rootKey: `k${index}`, oldValue: 'nil', newValue: '1', changeType: 'create' as const }],
  }));

describe('导航辅助函数', () => {
  const filtered = makeTPs([2, 5, 8, 12]);

  describe('findNextIndex', () => {
    it('从 0 跳到 2（第一个筛选时间点）', () => {
      expect(findNextIndex(0, filtered)).toBe(2);
    });
    it('从 2 跳到 5', () => {
      expect(findNextIndex(2, filtered)).toBe(5);
    });
    it('从 5 跳到 8', () => {
      expect(findNextIndex(5, filtered)).toBe(8);
    });
    it('从 12 无下一个，返回 -1', () => {
      expect(findNextIndex(12, filtered)).toBe(-1);
    });
    it('从 3 跳到 5（跳过间隔）', () => {
      expect(findNextIndex(3, filtered)).toBe(5);
    });
    it('筛选为空，返回 -1', () => {
      expect(findNextIndex(0, [])).toBe(-1);
    });
  });

  describe('findPrevIndex', () => {
    it('从 12 跳到 8', () => {
      expect(findPrevIndex(12, filtered)).toBe(8);
    });
    it('从 8 跳到 5', () => {
      expect(findPrevIndex(8, filtered)).toBe(5);
    });
    it('从 2 无上一个，返回 -1', () => {
      expect(findPrevIndex(2, filtered)).toBe(-1);
    });
    it('从 7 跳到 5（跳过间隔）', () => {
      expect(findPrevIndex(7, filtered)).toBe(5);
    });
    it('筛选为空，返回 -1', () => {
      expect(findPrevIndex(0, [])).toBe(-1);
    });
  });

  describe('findFirstIndex', () => {
    it('返回筛选列表第一个的 index', () => {
      expect(findFirstIndex(filtered)).toBe(2);
    });
    it('筛选为空，返回 -1', () => {
      expect(findFirstIndex([])).toBe(-1);
    });
  });

  describe('findLastIndex', () => {
    it('返回筛选列表最后一个的 index', () => {
      expect(findLastIndex(filtered)).toBe(12);
    });
    it('筛选为空，返回 -1', () => {
      expect(findLastIndex([])).toBe(-1);
    });
  });
});

describe('useArchiveData.loadFromText', () => {
  it('接收清洗格式 CSV 后正确生成 TimePoint[]', async () => {
    const csvText = [
      '日志时间,archive_diff',
      '2026-03-20 10:00:01,"|89-宝石ID=nil>>>100|"',
      '2026-03-20 10:00:02,"|89-宝石ID=100>>>200|"',
    ].join('\n');

    const { result } = renderHook(() => useArchiveData());

    await act(async () => {
      await result.current.loadFromText(csvText, 'CSV: 123 × 456');
    });

    expect(result.current.timePoints).toHaveLength(2);
    expect(result.current.fileName).toBe('CSV: 123 × 456');
  });

  it('loadFromText 重置 filter 和 selectedIndex（与 loadFile 行为一致）', async () => {
    const csvText = '日志时间,archive_diff\n2026-03-20 10:00:01,"|key=nil>>>1|"';
    const { result } = renderHook(() => useArchiveData());

    await act(async () => {
      await result.current.loadFromText(csvText, 'test');
    });

    expect(result.current.filter.rootKeys).toEqual([]);
    expect(result.current.filter.searchKeyword).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('空输入（无 archive_diff 行）设置 error 状态，timePoints 保持空', async () => {
    const csvText = '日志时间,archive_diff\n';
    const { result } = renderHook(() => useArchiveData());

    await act(async () => {
      await result.current.loadFromText(csvText, 'empty');
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.timePoints).toHaveLength(0);
  });
});

describe('buildDownloadFileName', () => {
  it('appends _clean.csv to base name', () => {
    expect(buildDownloadFileName('archive_diff_export (31).csv')).toBe('up5_csv (31)_clean.csv');
  });

  it('handles name without .csv extension', () => {
    expect(buildDownloadFileName('data.CSV')).toBe('data_clean.csv');
  });

  it('handles name with no extension', () => {
    expect(buildDownloadFileName('myfile')).toBe('myfile_clean.csv');
  });
});
