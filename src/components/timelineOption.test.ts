import { describe, expect, it } from 'vitest';
import type { ArchiveChange, TimePoint } from '../types';
import { buildTimelineStats } from './timelineStats';
import {
  SELECTED_COLOR,
  TIMELINE_MAX_RENDER_POINTS,
  TIMELINE_MAIN_SERIES_ID,
  buildTimelineBaseOption,
  buildTimelineDisplayData,
  buildTimelineOverlayGeometry,
  findTimelineDisplayIndex,
  formatTimelineTooltip,
  markTimelineSelection,
  resolveTimelineSelectionPoint,
} from './timelineOption';

interface TestSeries {
  id: string;
  data: Array<{
    value: [number, number];
    itemStyle?: {
      color?: string;
      opacity?: number;
    };
  }>;
}

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

describe('timeline option', () => {
  const timePoints = [
    point(0, [change('74-a', 'create'), change('74-b', 'update')]),
    point(1, [change('74-c', 'delete'), change('74-d', 'delete')]),
  ];
  const stats = buildTimelineStats(
    timePoints,
    new Map<number, TimePoint>(timePoints.map((tp) => [tp.index, tp])),
  );

  it('keeps the full base series independent from the selected frame', () => {
    const option = buildTimelineBaseOption(stats, true);
    const main = option.series[0] as unknown as TestSeries;

    expect(option.series).toHaveLength(1);
    expect(main.id).toBe(TIMELINE_MAIN_SERIES_ID);
    expect(main.data).toHaveLength(2);
    expect(main.data[0]).toMatchObject({
      value: [timePoints[0].timestamp.getTime(), 2],
      itemStyle: { color: '#84c8a4', opacity: 0.62 },
    });
    expect(main.data[1]).toMatchObject({
      value: [timePoints[1].timestamp.getTime(), 2],
      itemStyle: { color: '#d4868b', opacity: 0.62 },
    });
    expect(main.data.some((item) => item.itemStyle?.color === SELECTED_COLOR)).toBe(false);
  });

  it('maps the selected frame onto the exact rendered bar and grid coordinates', () => {
    const geometry = buildTimelineOverlayGeometry(
      { x: 100, y: 40, width: 6, height: 80 },
      { x: 44, y: 12, width: 900, height: 100 },
    );

    expect(geometry).toEqual({
      barLeft: 100,
      barTop: 40,
      barWidth: 6,
      barHeight: 80,
      lineLeft: 103,
      lineTop: 12,
      lineHeight: 100,
      markerLeft: 98,
      markerTop: 29,
    });
  });

  it('keeps the current-node tooltip marker tied to the latest selected frame', () => {
    const option = buildTimelineBaseOption(stats, true);
    const data = option.series[0].data;
    const params = { value: [timePoints[1].timestamp.getTime(), 2] as [number, number], data: data[1] };

    markTimelineSelection(1);

    expect(formatTimelineTooltip(params)).toContain('当前节点');
    expect(formatTimelineTooltip(params)).toContain('节点 #2');

    markTimelineSelection(0);

    expect(formatTimelineTooltip(params)).not.toContain('当前节点');
  });

  it('uses the log-axis zero placeholder for an empty selected frame', () => {
    const sparseTimePoints = [
      point(0, []),
      point(1, [change('74-a', 'create')]),
      point(2, Array.from({ length: 20 }, (_, index) => change(`74-${index}`, 'update'))),
    ];
    const sparseStats = buildTimelineStats(
      sparseTimePoints,
      new Map<number, TimePoint>([
        [1, sparseTimePoints[1]],
        [2, sparseTimePoints[2]],
      ]),
    );

    expect(sparseStats.useLogAxis).toBe(true);
    const base = buildTimelineBaseOption(sparseStats, true);
    const baseMain = base.series[0] as unknown as TestSeries;
    const selected = resolveTimelineSelectionPoint(sparseStats, 0);

    expect(baseMain.data[0].value).toEqual([sparseTimePoints[0].timestamp.getTime(), 0.5]);
    expect(selected).toEqual({
      timestampMs: sparseTimePoints[0].timestamp.getTime(),
      rawCount: 0,
      displayCount: 0.5,
    });
  });

  it('aggregates large datasets into bounded display buckets while keeping exact frame ranges', () => {
    const largeTimePoints = Array.from({ length: 2001 }, (_, index) => point(index, [change(`74-${index}`, 'create')]));
    const largeStats = buildTimelineStats(
      largeTimePoints,
      new Map<number, TimePoint>(largeTimePoints.map((tp) => [tp.index, tp])),
    );
    const option = buildTimelineBaseOption(largeStats, true);
    const series = option.series as unknown as TestSeries[];
    const display = buildTimelineDisplayData(largeStats);

    expect(series).toHaveLength(1);
    expect(display.length).toBeLessThanOrEqual(TIMELINE_MAX_RENDER_POINTS);
    expect(display.every((datum) => datum._isAggregated)).toBe(true);
    expect(display[0]).toMatchObject({
      _bucketStartIndex: 0,
      _bucketEndIndex: 2,
      _frameCount: 3,
      _totalChanges: 3,
      _tpIndex: 0,
    });
    expect(findTimelineDisplayIndex(display, 1)).toBe(0);
    expect(findTimelineDisplayIndex(display, 2000)).toBe(display.length - 1);
  });
});
