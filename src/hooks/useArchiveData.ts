import { useState, useCallback, useMemo } from 'react';
import type { TimePoint, FilterState, ArchiveChange, RawLogRow } from '../types';
import { parseCsvFile, parseCsvText } from '../parser/csvParser';
import { buildTimePoints, extractRootKeys } from '../parser/pipeline';
import { SnapshotEngine } from '../engine/snapshotEngine';
import { generateCleanCsv } from '../utils/generateCleanCsv';

const DEFAULT_FILTER: FilterState = {
  timeRange: null,
  rootKeys: [],
  changeTypes: [],
  searchKeyword: '',
};

export function useArchiveData() {
  const [timePoints, setTimePoints] = useState<TimePoint[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<RawLogRow[]>([]);

  const availableRootKeys = useMemo(() => extractRootKeys(timePoints), [timePoints]);
  const snapshotEngine = useMemo(() => new SnapshotEngine(timePoints), [timePoints]);

  const filteredTimePoints = useMemo(() => {
    return timePoints
      .filter((tp) => {
        if (filter.timeRange) {
          const [start, end] = filter.timeRange;
          if (tp.timestamp < start || tp.timestamp > end) return false;
        }
        return true;
      })
      .map((tp) => {
        const filteredChanges = filterChanges(tp.changes, filter);
        if (filteredChanges.length === 0) return null;
        return { ...tp, changes: filteredChanges };
      })
      .filter((tp): tp is TimePoint => tp !== null);
  }, [timePoints, filter]);

  // O(1) index Map: index → filteredTimePoint
  const filteredIndexMap = useMemo(() => {
    const map = new Map<number, TimePoint>();
    for (const tp of filteredTimePoints) {
      map.set(tp.index, tp);
    }
    return map;
  }, [filteredTimePoints]);

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await parseCsvFile(file);
      const tps = buildTimePoints(rows);

      if (tps.length === 0) {
        setError('未找到包含 archive_diff 的日志行，请确认 CSV 是 原始导出日志、清洗后的 archive_diff CSV，或包含 matched_log_raw 的检测结果 CSV。');
        return;
      }
      setTimePoints(tps);
      setSelectedIndex(0);
      setFileName(file.name);
      setRawRows(rows);
      setFilter(DEFAULT_FILTER);
    } catch (e) {
      console.error('[error] loadFile failed:', e);
      setError(e instanceof Error ? e.message : '解析文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFromText = useCallback(async (csvText: string, sourceName: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = parseCsvText(csvText);
      const tps = buildTimePoints(rows);

      if (tps.length === 0) {
        setError('未找到包含 archive_diff 的日志行，请确认 CSV 是 原始导出日志、清洗后的 archive_diff CSV，或包含 matched_log_raw 的检测结果 CSV。');
        return;
      }
      setTimePoints(tps);
      setSelectedIndex(0);
      setFileName(sourceName);
      setRawRows(rows);
      setFilter(DEFAULT_FILTER);
    } catch (e) {
      console.error('[error] loadFromText failed:', e);
      setError(e instanceof Error ? e.message : '解析文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const goToPrev = useCallback(() => {
    const target = findPrevIndex(selectedIndex, filteredTimePoints);
    if (target >= 0) setSelectedIndex(target);
  }, [selectedIndex, filteredTimePoints]);

  const goToNext = useCallback(() => {
    const target = findNextIndex(selectedIndex, filteredTimePoints);
    if (target >= 0) setSelectedIndex(target);
  }, [selectedIndex, filteredTimePoints]);

  const goToFirst = useCallback(() => {
    const target = findFirstIndex(filteredTimePoints);
    if (target >= 0) setSelectedIndex(target);
  }, [filteredTimePoints]);

  const goToLast = useCallback(() => {
    const target = findLastIndex(filteredTimePoints);
    if (target >= 0) setSelectedIndex(target);
  }, [filteredTimePoints]);

  const goToIndex = useCallback((index: number) => {
    setSelectedIndex(Math.max(0, Math.min(timePoints.length - 1, index)));
  }, [timePoints.length]);

  const downloadCleanCsv = useCallback(() => {
    if (rawRows.length === 0 || !fileName) return;

    const csvString = generateCleanCsv(rawRows);
    const downloadName = buildDownloadFileName(fileName);

    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [rawRows, fileName]);


  return {
    timePoints, filteredTimePoints, filteredIndexMap,
    selectedIndex, filter, fileName, loading, error,
    availableRootKeys, snapshotEngine, loadFile, loadFromText, setFilter,
    setSelectedIndex: goToIndex, goToPrev, goToNext, goToFirst, goToLast,
    downloadCleanCsv,
  };
}

/** 在 filteredTimePoints 中查找 index > currentIndex 的第一个，返回其 index；找不到返回 -1 */
export function findNextIndex(currentIndex: number, filtered: TimePoint[]): number {
  const tp = filtered.find(tp => tp.index > currentIndex);
  return tp ? tp.index : -1;
}

/** 在 filteredTimePoints 中查找 index < currentIndex 的最后一个，返回其 index；找不到返回 -1 */
export function findPrevIndex(currentIndex: number, filtered: TimePoint[]): number {
  for (let i = filtered.length - 1; i >= 0; i--) {
    if (filtered[i].index < currentIndex) return filtered[i].index;
  }
  return -1;
}

/** 返回 filteredTimePoints 第一个的 index；为空返回 -1 */
export function findFirstIndex(filtered: TimePoint[]): number {
  return filtered.length > 0 ? filtered[0].index : -1;
}

/** 返回 filteredTimePoints 最后一个的 index；为空返回 -1 */
export function findLastIndex(filtered: TimePoint[]): number {
  return filtered.length > 0 ? filtered[filtered.length - 1].index : -1;
}

function filterChanges(changes: ArchiveChange[], filter: FilterState): ArchiveChange[] {
  return changes.filter((c) => {
    if (filter.rootKeys.length > 0 && !filter.rootKeys.includes(c.rootKey)) return false;
    if (filter.changeTypes.length > 0 && !filter.changeTypes.includes(c.changeType)) return false;
    if (filter.searchKeyword) {
      if (!matchSearchKeyword(c, filter.searchKeyword)) return false;
    }
    return true;
  });
}

function matchSearchKeyword(change: ArchiveChange, keyword: string): boolean {
  const text = `${change.key} ${change.oldValue} ${change.newValue}`.toLowerCase();

  // 支持 && 和 || 运算符
  if (keyword.includes('||')) {
    return keyword.split('||').some(term => text.includes(term.trim().toLowerCase()));
  }
  if (keyword.includes('&&')) {
    return keyword.split('&&').every(term => text.includes(term.trim().toLowerCase()));
  }

  // 单个关键词
  return text.includes(keyword.toLowerCase());
}

/** Build the download file name: strip .csv extension, normalize known exports, append _clean.csv */
export function buildDownloadFileName(originalName: string): string {
  const baseName = originalName
    .replace(/\.csv$/i, '')
    .replace(/^archive_diff_export(?=\s*(?:\(|$))/i, 'up5_csv');
  return `${baseName}_clean.csv`;
}
