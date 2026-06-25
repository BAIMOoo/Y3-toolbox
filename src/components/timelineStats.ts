import type { TimePoint } from '../types';

export interface TimelineDatum {
  value: [number, number];
  baseColor: string;
  _tpIndex: number;
  _rawCount: number;
  _createCount: number;
  _updateCount: number;
  _deleteCount: number;
}

export interface TimelinePointStats {
  index: number;
  rawCount: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  timestampMs: number;
  baseColor: string;
}

export interface TimelineStatsSummary {
  counts: number[];
  data: TimelineDatum[];
  byIndex: Map<number, TimelinePointStats>;
  useLogAxis: boolean;
  totalChanges: number;
}

const COLOR_CREATE = '#84c8a4';
const COLOR_UPDATE = '#d7b46a';
const COLOR_DELETE = '#d4868b';
const COLOR_NONE = '#202837';

function blendChangeColor(createCount: number, updateCount: number, deleteCount: number, total: number): string {
  if (total === 0) return COLOR_NONE;
  if (deleteCount / total > 0.6) return COLOR_DELETE;
  if (createCount / total > 0.6) return COLOR_CREATE;
  if (updateCount / total > 0.5) return COLOR_UPDATE;
  const max = Math.max(createCount, updateCount, deleteCount);
  if (max === createCount) return COLOR_CREATE;
  if (max === deleteCount) return COLOR_DELETE;
  return COLOR_UPDATE;
}

export function buildTimelineStats(timePoints: TimePoint[], filteredIndexMap: Map<number, TimePoint>): TimelineStatsSummary {
  let maxCount = 0;
  let minNonZero = Infinity;
  let totalChanges = 0;
  const counts: number[] = [];
  const byIndex = new Map<number, TimelinePointStats>();

  for (const tp of timePoints) {
    const filtered = filteredIndexMap.get(tp.index);
    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;

    if (filtered) {
      for (const change of filtered.changes) {
        if (change.changeType === 'create') createCount++;
        else if (change.changeType === 'update') updateCount++;
        else if (change.changeType === 'delete') deleteCount++;
      }
    }

    const rawCount = filtered ? filtered.changes.length : 0;
    counts.push(rawCount);
    totalChanges += rawCount;
    if (rawCount > maxCount) maxCount = rawCount;
    if (rawCount > 0 && rawCount < minNonZero) minNonZero = rawCount;

    byIndex.set(tp.index, {
      index: tp.index,
      rawCount,
      createCount,
      updateCount,
      deleteCount,
      timestampMs: tp.timestamp.getTime(),
      baseColor: blendChangeColor(createCount, updateCount, deleteCount, rawCount),
    });
  }

  const useLogAxis = maxCount > 0 && minNonZero < Infinity && maxCount / minNonZero > 10;
  const data: TimelineDatum[] = timePoints.map((tp) => {
    const stats = byIndex.get(tp.index);
    const rawCount = stats?.rawCount ?? 0;
    const displayCount = useLogAxis ? (rawCount === 0 ? 0.5 : rawCount) : rawCount;

    return {
      value: [tp.timestamp.getTime(), displayCount],
      baseColor: stats?.baseColor ?? COLOR_NONE,
      _tpIndex: tp.index,
      _rawCount: rawCount,
      _createCount: stats?.createCount ?? 0,
      _updateCount: stats?.updateCount ?? 0,
      _deleteCount: stats?.deleteCount ?? 0,
    };
  });

  return { counts, data, byIndex, useLogAxis, totalChanges };
}
