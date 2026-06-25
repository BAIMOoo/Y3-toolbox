import { describe, expect, it } from 'vitest';
import type { ArchiveChange, TimePoint } from '../types';
import { buildTimelineStats } from './timelineStats';

function change(key: string, changeType: ArchiveChange['changeType']): ArchiveChange {
  const keyParts = key.split('-');
  return {
    key,
    keyParts,
    rootKey: keyParts[0],
    oldValue: changeType === 'create' ? 'nil' : '1',
    newValue: changeType === 'delete' ? 'nil' : '2',
    changeType,
  };
}

function point(index: number, changes: ArchiveChange[]): TimePoint {
  return {
    index,
    timestamp: new Date(Date.UTC(2026, 0, 1, 10, index, 0)),
    changes,
  };
}

describe('buildTimelineStats', () => {
  it('precomputes raw/create/update/delete counts independent of selectedIndex', () => {
    const timePoints = [
      point(0, [change('74-a', 'create'), change('74-b', 'update')]),
      point(1, [change('74-c', 'delete'), change('74-d', 'delete')]),
    ];
    const filteredIndexMap = new Map<number, TimePoint>(timePoints.map((tp) => [tp.index, tp]));

    const stats = buildTimelineStats(timePoints, filteredIndexMap);

    expect(stats.totalChanges).toBe(4);
    expect(stats.counts).toEqual([2, 2]);
    expect(stats.byIndex.get(0)).toMatchObject({ rawCount: 2, createCount: 1, updateCount: 1, deleteCount: 0 });
    expect(stats.byIndex.get(1)).toMatchObject({ rawCount: 2, createCount: 0, updateCount: 0, deleteCount: 2 });
    expect(stats.data.map((datum) => [datum._tpIndex, datum._rawCount, datum._createCount, datum._updateCount, datum._deleteCount])).toEqual([
      [0, 2, 1, 1, 0],
      [1, 2, 0, 0, 2],
    ]);
  });

  it('uses filtered time point changes rather than raw changes', () => {
    const rawPoints = [
      point(0, [change('74-a', 'create'), change('88-b', 'update')]),
    ];
    const filteredPoint = point(0, [change('74-a', 'create')]);
    const stats = buildTimelineStats(rawPoints, new Map([[0, filteredPoint]]));

    expect(stats.totalChanges).toBe(1);
    expect(stats.byIndex.get(0)).toMatchObject({ rawCount: 1, createCount: 1, updateCount: 0, deleteCount: 0 });
  });
});
