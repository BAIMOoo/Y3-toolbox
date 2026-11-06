import type { TimelineDatum, TimelineStatsSummary } from './timelineStats';

export const TIMELINE_MAIN_SERIES_ID = 'timeline-main';
export const TIMELINE_MAX_RENDER_POINTS = 1000;

export const SELECTED_COLOR = '#a9bbdf';
export const SELECTED_GLOW = 'rgba(169, 187, 223, 0.22)';
export const SELECTED_LIGHT = '#c2cce1';
export const SELECTED_LINE = 'rgba(169, 187, 223, 0.52)';

const COLOR_CREATE = '#84c8a4';
const COLOR_UPDATE = '#d7b46a';
const COLOR_DELETE = '#d4868b';

interface TooltipParam {
  value: [number, number];
  data?: TimelineDisplayDatum & { itemStyle?: unknown };
}

let selectedTimelineDatumId: number | null = null;

export interface TimelineDisplayDatum extends TimelineDatum {
  _selectionId: number;
  _bucketStartIndex: number;
  _bucketEndIndex: number;
  _bucketStartTimeMs: number;
  _bucketEndTimeMs: number;
  _frameCount: number;
  _totalChanges: number;
  _isAggregated: boolean;
}

export interface TimelineSelectionPoint {
  timestampMs: number;
  rawCount: number;
  displayCount: number;
}

export interface TimelineBarLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelineGridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelineOverlayGeometry {
  barLeft: number;
  barTop: number;
  barWidth: number;
  barHeight: number;
  lineLeft: number;
  lineTop: number;
  lineHeight: number;
  markerLeft: number;
  markerTop: number;
}

export function markTimelineSelection(selectedIndex: number | null): void {
  selectedTimelineDatumId = selectedIndex;
}

export function isTimelineDatumSelected(datum: unknown): boolean {
  if (typeof datum !== 'object' || datum === null) return false;
  if (selectedTimelineDatumId === null) return false;
  const item = datum as { _selectionId?: number; _bucketStartIndex?: number; _bucketEndIndex?: number };
  if (item._bucketStartIndex !== undefined && item._bucketEndIndex !== undefined) {
    return selectedTimelineDatumId >= item._bucketStartIndex
      && selectedTimelineDatumId <= item._bucketEndIndex;
  }
  return item._selectionId === selectedTimelineDatumId;
}

export function formatTimelineTooltip(params: TooltipParam): string {
  const date = new Date(params.value[0]);
  const dateStr = date.toLocaleString('zh-CN');
  const index = params.data?._tpIndex;
  const rawCount = params.data?._rawCount ?? 0;
  const createCount = params.data?._createCount ?? 0;
  const updateCount = params.data?._updateCount ?? 0;
  const deleteCount = params.data?._deleteCount ?? 0;
  const isCurrent = isTimelineDatumSelected(params.data);

  const marker = isCurrent
    ? `<span style="color:${SELECTED_COLOR};font-weight:700;letter-spacing:.03em">▸ 当前节点</span><br/>`
    : '';

  const countDetail = rawCount > 0
    ? `<div style="margin-top:4px;display:flex;gap:8px">
        <span style="color:${COLOR_CREATE}">+${createCount}</span>
        <span style="color:${COLOR_UPDATE}">~${updateCount}</span>
        <span style="color:${COLOR_DELETE}">-${deleteCount}</span>
      </div>`
    : '';

  if (params.data?._isAggregated) {
    const start = new Date(params.data._bucketStartTimeMs).toLocaleString('zh-CN');
    const end = new Date(params.data._bucketEndTimeMs).toLocaleString('zh-CN');
    return `${marker}<span style="color:#687385;font-size:10px">${start} 至 ${end}</span><br/>
      <span style="font-size:13px;font-weight:600;color:#e5eaf2">${params.data._totalChanges}</span>
      <span style="color:#687385"> 条变动 · ${params.data._frameCount} 帧</span>
      <div style="margin-top:3px;color:#687385;font-size:10px">峰值 ${rawCount} 条/帧</div>${countDetail}
      ${index !== undefined ? `<div style="margin-top:3px;color:#465061;font-size:9px">点击跳到峰值帧 #${index + 1}</div>` : ''}`;
  }

  return `${marker}<span style="color:#687385;font-size:10px">${dateStr}</span><br/>
    <span style="font-size:13px;font-weight:600;color:#e5eaf2">${rawCount}</span>
    <span style="color:#687385"> 条变动</span>${countDetail}
    ${index !== undefined ? `<div style="margin-top:3px;color:#465061;font-size:9px">节点 #${index + 1}</div>` : ''}`;
}

export function buildTimelineDisplayData(timelineStats: TimelineStatsSummary): TimelineDisplayDatum[] {
  const source = timelineStats.data;
  if (source.length <= TIMELINE_MAX_RENDER_POINTS) {
    return source.map((datum) => ({
      ...datum,
      _selectionId: datum._tpIndex,
      _bucketStartIndex: datum._tpIndex,
      _bucketEndIndex: datum._tpIndex,
      _bucketStartTimeMs: datum.value[0],
      _bucketEndTimeMs: datum.value[0],
      _frameCount: 1,
      _totalChanges: datum._rawCount,
      _isAggregated: false,
    }));
  }

  const bucketSize = Math.ceil(source.length / TIMELINE_MAX_RENDER_POINTS);
  const display: TimelineDisplayDatum[] = [];

  for (let start = 0; start < source.length; start += bucketSize) {
    const end = Math.min(source.length, start + bucketSize);
    let peak = source[start];
    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;
    let totalChanges = 0;

    for (let i = start; i < end; i++) {
      const datum = source[i];
      createCount += datum._createCount;
      updateCount += datum._updateCount;
      deleteCount += datum._deleteCount;
      totalChanges += datum._rawCount;
      if (datum._rawCount > peak._rawCount) peak = datum;
    }

    const bucketStart = source[start];
    const bucketEnd = source[end - 1];
    display.push({
      ...peak,
      _selectionId: peak._tpIndex,
      _bucketStartIndex: bucketStart._tpIndex,
      _bucketEndIndex: bucketEnd._tpIndex,
      _bucketStartTimeMs: bucketStart.value[0],
      _bucketEndTimeMs: bucketEnd.value[0],
      _frameCount: end - start,
      _totalChanges: totalChanges,
      _createCount: createCount,
      _updateCount: updateCount,
      _deleteCount: deleteCount,
      _isAggregated: true,
    });
  }

  return display;
}

export function findTimelineDisplayIndex(
  data: ReadonlyArray<Pick<TimelineDisplayDatum, '_bucketStartIndex' | '_bucketEndIndex'>>,
  selectedIndex: number,
): number {
  return data.findIndex((datum) => (
    selectedIndex >= datum._bucketStartIndex && selectedIndex <= datum._bucketEndIndex
  ));
}

export function buildTimelineBaseOption(
  timelineStats: TimelineStatsSummary,
  prefersReducedMotion: boolean,
) {
  const { useLogAxis } = timelineStats;
  const isAggregated = timelineStats.data.length > TIMELINE_MAX_RENDER_POINTS;
  const animationEnabled = !prefersReducedMotion && !isAggregated;
  const data = buildTimelineDisplayData(timelineStats).map((datum) => {
    const rawCount = datum._rawCount;

    return {
      ...datum,
      itemStyle: {
        color: datum.baseColor,
        opacity: rawCount > 0 ? 0.62 : 0.16,
        borderRadius: [2, 2, 0, 0],
        shadowColor: 'transparent',
        shadowBlur: 0,
      },
      emphasis: {
        itemStyle: {
          opacity: 0.95,
          shadowColor: 'transparent',
          shadowBlur: 0,
        },
      },
    };
  });

  const yAxisConfig = useLogAxis
    ? {
        type: 'log' as const,
        logBase: 10,
        min: 0.5,
        axisLabel: {
          color: '#596579',
          fontSize: 9,
          fontFamily: "'JetBrains Mono', monospace",
          formatter: (val: number) => (val < 1 ? '0' : String(Math.round(val))),
        },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#222a36', type: 'dashed' as const, opacity: 0.46 } },
      }
    : {
        type: 'value' as const,
        axisLabel: {
          color: '#596579',
          fontSize: 9,
          fontFamily: "'JetBrains Mono', monospace",
        },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#222a36', type: 'dashed' as const, opacity: 0.46 } },
        minInterval: 1,
      };

  return {
    grid: { left: 44, right: 12, top: 12, bottom: 32 },
    xAxis: {
      type: 'time',
      axisLabel: {
        color: '#596579',
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
      },
      axisLine: { lineStyle: { color: '#222a36' } },
      splitLine: { show: false },
      axisTick: { lineStyle: { color: '#222a36' } },
    },
    yAxis: yAxisConfig,
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(16, 20, 28, 0.98)',
      borderColor: 'rgba(142, 164, 210, 0.24)',
      borderWidth: 1,
      textStyle: { color: '#e5eaf2', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
      formatter: (params: TooltipParam) => formatTimelineTooltip(params),
      extraCssText:
        'box-shadow:0 10px 28px rgba(0,0,0,0.35);border-radius:8px;padding:10px 14px;',
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
      },
    ],
    series: [
      {
        id: TIMELINE_MAIN_SERIES_ID,
        type: 'bar',
        data,
        barMaxWidth: 9,
        barMinWidth: 2,
      },
    ],
    animation: animationEnabled,
    animationDuration: animationEnabled ? 180 : 0,
    animationEasing: 'cubicOut',
  };
}

export function resolveTimelineSelectionPoint(
  timelineStats: TimelineStatsSummary,
  selectedIndex: number,
): TimelineSelectionPoint | null {
  const selectedStats = timelineStats.byIndex.get(selectedIndex);
  const timestamp = selectedStats?.timestampMs;
  if (timestamp === undefined) return null;
  const rawCount = selectedStats?.rawCount ?? 0;
  const displayCount = timelineStats.useLogAxis
    ? (rawCount === 0 ? 0.5 : rawCount)
    : rawCount;

  return {
    timestampMs: timestamp,
    rawCount,
    displayCount,
  };
}

export function buildTimelineOverlayGeometry(
  bar: TimelineBarLayout,
  grid: TimelineGridRect,
): TimelineOverlayGeometry {
  const centerX = bar.x + bar.width / 2;

  return {
    barLeft: bar.x,
    barTop: bar.y,
    barWidth: bar.width,
    barHeight: bar.height,
    lineLeft: centerX,
    lineTop: grid.y,
    lineHeight: grid.height,
    markerLeft: centerX - 5,
    markerTop: bar.y - 11,
  };
}
