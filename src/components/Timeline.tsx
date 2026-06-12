// src/components/Timeline.tsx
import React, { useMemo, useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { TimePoint } from '../types';

/** ECharts tooltip formatter 参数类型 */
interface TooltipParam {
  value: [number, number];
  data?: { _tpIndex?: number; _rawCount?: number; _createCount?: number; _updateCount?: number; _deleteCount?: number };
}

/** ECharts click 事件参数类型 */
interface ChartClickParam {
  data?: { _tpIndex?: number };
}

interface TimelineProps {
  timePoints: TimePoint[];
  filteredTimePoints: TimePoint[];
  filteredIndexMap: Map<number, TimePoint>;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}

/**
 * 根据数据特征计算动态图表高度。
 */
function computeChartHeight(timePoints: TimePoint[], filteredIndexMap: Map<number, TimePoint>): number {
  if (timePoints.length === 0) return 90;

  let maxCount = 0;
  for (const tp of timePoints) {
    const filtered = filteredIndexMap.get(tp.index);
    if (filtered) {
      maxCount = Math.max(maxCount, filtered.changes.length);
    }
  }

  const pointCount = timePoints.length;
  let height = 90;
  height += Math.min(50, Math.floor(pointCount / 20) * 5);
  if (maxCount > 20) {
    height += Math.min(30, Math.floor((maxCount - 20) / 20) * 6);
  }
  return Math.max(90, Math.min(180, height));
}

/** 格式化时间为 HH:mm:ss */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 格式化时间为简短格式 MM-DD HH:mm */
function formatTimeShort(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}`;
}

function getPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    handleChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener?.(handleChange);
    return () => mediaQuery.removeListener?.(handleChange);
  }, []);

  return prefersReducedMotion;
}

// ——— 选中节点色彩系统：低饱和蓝灰，减少 glow ———
const SELECTED_COLOR = '#a9bbdf';
const SELECTED_GLOW = 'rgba(169, 187, 223, 0.22)';
const SELECTED_LIGHT = '#c2cce1';
const SELECTED_LINE = 'rgba(169, 187, 223, 0.52)';

// ——— 时间轴专用配色：专业工具低饱和语义色 ———
const COLOR_CREATE = '#84c8a4';
const COLOR_UPDATE = '#d7b46a';
const COLOR_DELETE = '#d4868b';
const COLOR_NONE = '#202837';

/** 根据变动类型比例混合出柱子颜色 */
function blendChangeColor(createCount: number, updateCount: number, deleteCount: number, total: number): string {
  if (total === 0) return COLOR_NONE;
  if (deleteCount / total > 0.6) return COLOR_DELETE;
  if (createCount / total > 0.6) return COLOR_CREATE;
  if (updateCount / total > 0.5) return COLOR_UPDATE;
  // 混合色：以最多的类型为主
  const max = Math.max(createCount, updateCount, deleteCount);
  if (max === createCount) return COLOR_CREATE;
  if (max === deleteCount) return COLOR_DELETE;
  return COLOR_UPDATE;
}

// SVG 图标组件
const IconFirst = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <rect x="1" y="2" width="2" height="8" rx="1"/>
    <path d="M10 2L4 6l6 4V2z"/>
  </svg>
);
const IconPrev = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M8.5 2L3 6l5.5 4V2z"/>
  </svg>
);
const IconNext = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M3.5 2L9 6 3.5 10V2z"/>
  </svg>
);
const IconLast = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <rect x="9" y="2" width="2" height="8" rx="1"/>
    <path d="M2 2l6 4-6 4V2z"/>
  </svg>
);

export const Timeline: React.FC<TimelineProps> = ({
  timePoints,
  filteredTimePoints,
  filteredIndexMap,
  selectedIndex,
  onSelectIndex,
  onPrev,
  onNext,
  onFirst,
  onLast,
}) => {
  const prefersReducedMotion = usePrefersReducedMotion();

  // 动态计算图表高度
  const chartHeight = useMemo(
    () => computeChartHeight(timePoints, filteredIndexMap),
    [timePoints, filteredIndexMap]
  );

  const option = useMemo(() => {
    if (timePoints.length === 0) return {};

    let maxCount = 0;
    let minNonZero = Infinity;
    const counts: number[] = [];

    for (const tp of timePoints) {
      const filtered = filteredIndexMap.get(tp.index);
      const count = filtered ? filtered.changes.length : 0;
      counts.push(count);
      if (count > maxCount) maxCount = count;
      if (count > 0 && count < minNonZero) minNonZero = count;
    }

    const useLogAxis = maxCount > 0 && minNonZero < Infinity && maxCount / minNonZero > 10;

    const data = timePoints.map((tp) => {
      const filtered = filteredIndexMap.get(tp.index);
      const rawCount = filtered ? filtered.changes.length : 0;
      const isSelected = tp.index === selectedIndex;

      // 统计各类变动数量
      const createCount = filtered ? filtered.changes.filter(c => c.changeType === 'create').length : 0;
      const updateCount = filtered ? filtered.changes.filter(c => c.changeType === 'update').length : 0;
      const deleteCount = filtered ? filtered.changes.filter(c => c.changeType === 'delete').length : 0;

      const barColor = isSelected
        ? SELECTED_COLOR
        : blendChangeColor(createCount, updateCount, deleteCount, rawCount);

      const displayCount = useLogAxis ? (rawCount === 0 ? 0.5 : rawCount) : rawCount;

      return {
        value: [tp.timestamp.getTime(), displayCount],
        itemStyle: {
          color: barColor,
          opacity: isSelected ? 0.95 : rawCount > 0 ? 0.62 : 0.16,
          borderRadius: isSelected ? [3, 3, 0, 0] : [2, 2, 0, 0],
          shadowColor: isSelected ? SELECTED_GLOW : 'transparent',
          shadowBlur: isSelected ? 5 : 0,
        },
        emphasis: {
          itemStyle: {
            opacity: 0.95,
            shadowColor: isSelected ? SELECTED_GLOW : 'transparent',
            shadowBlur: isSelected ? 6 : 0,
          },
        },
        _tpIndex: tp.index,
        _rawCount: rawCount,
        _createCount: createCount,
        _updateCount: updateCount,
        _deleteCount: deleteCount,
      };
    });

    // 选中 markLine
    const selectedTP = timePoints[selectedIndex];
    const markLineData = selectedTP
      ? [
          {
            xAxis: selectedTP.timestamp.getTime(),
            lineStyle: {
              color: SELECTED_LINE,
              width: 1.5,
              type: 'solid' as const,
            },
            label: {
              show: true,
              formatter: formatTime(selectedTP.timestamp),
              position: 'insideStartTop' as const,
              color: '#d7deec',
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              backgroundColor: 'rgba(27, 34, 48, 0.96)',
              padding: [2, 6],
              borderRadius: 3,
            },
          },
        ]
      : [];

    // markPoint — 选中柱子顶部的倒三角指示器
    const markPointData = selectedTP
      ? [
          {
            coord: [
              selectedTP.timestamp.getTime(),
              useLogAxis
                ? (counts[selectedIndex] === 0 ? 0.5 : counts[selectedIndex])
                : counts[selectedIndex],
            ],
            symbol: 'triangle',
            symbolSize: [10, 6],
            symbolRotate: 180,
            symbolOffset: [0, -8],
            itemStyle: {
              color: SELECTED_COLOR,
              shadowColor: SELECTED_GLOW,
              shadowBlur: 4,
            },
            label: { show: false },
          },
        ]
      : [];

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
        formatter: (params: TooltipParam) => {
          const d = new Date(params.value[0]);
          const dateStr = d.toLocaleString('zh-CN');
          const idx = params.data?._tpIndex;
          const rawCount = params.data?._rawCount ?? 0;
          const createCount = params.data?._createCount ?? 0;
          const updateCount = params.data?._updateCount ?? 0;
          const deleteCount = params.data?._deleteCount ?? 0;
          const isCurrent = idx === selectedIndex;

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

          return `${marker}<span style="color:#687385;font-size:10px">${dateStr}</span><br/>
            <span style="font-size:13px;font-weight:600;color:#e5eaf2">${rawCount}</span>
            <span style="color:#687385"> 条变动</span>${countDetail}
            ${idx !== undefined ? `<div style="margin-top:3px;color:#465061;font-size:9px">节点 #${idx + 1}</div>` : ''}`;
        },
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
          type: 'bar',
          data,
          barMaxWidth: 9,
          barMinWidth: 2,
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            data: markLineData,
            animation: !prefersReducedMotion,
            animationDuration: prefersReducedMotion ? 0 : 250,
          },
          markPoint: {
            data: markPointData,
            animation: !prefersReducedMotion,
            animationDuration: prefersReducedMotion ? 0 : 250,
          },
        },
      ],
      animation: !prefersReducedMotion,
      animationDuration: prefersReducedMotion ? 0 : 180,
      animationEasing: 'cubicOut',
    };
  }, [timePoints, filteredIndexMap, selectedIndex, prefersReducedMotion]);

  const onEvents = useMemo(
    () => ({
      click: (params: ChartClickParam) => {
        if (params.data?._tpIndex !== undefined) {
          onSelectIndex(params.data._tpIndex);
        }
      },
    }),
    [onSelectIndex]
  );

  // Keep timeline changes visually stable: tooltip remains available on hover,
  // but frame navigation no longer auto-opens a floating tooltip that slides
  // toward the newly selected bar.

  if (timePoints.length === 0) {
    return null;
  }

  const totalChanges = filteredTimePoints.reduce((sum, tp) => sum + tp.changes.length, 0);
  const selectedTP = timePoints[selectedIndex];
  const selectedFilteredTP = filteredIndexMap.get(selectedIndex);
  const selectedChangeCount = selectedFilteredTP?.changes.length ?? 0;

  // 各类变动统计
  const selectedCreateCount = selectedFilteredTP?.changes.filter(c => c.changeType === 'create').length ?? 0;
  const selectedUpdateCount = selectedFilteredTP?.changes.filter(c => c.changeType === 'update').length ?? 0;
  const selectedDeleteCount = selectedFilteredTP?.changes.filter(c => c.changeType === 'delete').length ?? 0;

  // 进度百分比
  const progress =
    timePoints.length > 1
      ? Math.round((selectedIndex / (timePoints.length - 1)) * 100)
      : 100;

  // 首末时间
  const firstTP = timePoints[0];
  const lastTP = timePoints[timePoints.length - 1];

  // 判断是否在边界
  const isFirst =
    filteredTimePoints.length === 0 || selectedIndex === filteredTimePoints[0]?.index;
  const isLast =
    filteredTimePoints.length === 0 ||
    selectedIndex === filteredTimePoints[filteredTimePoints.length - 1]?.index;

  return (
    <div className="timeline-root">
      {/* ── 顶部信息栏 ── */}
      <div className="timeline-header">
        {/* 左：统计摘要 */}
        <div className="timeline-stats">
          <span className="timeline-label">时间线</span>
          <span className="timeline-divider">·</span>
          <span className="timeline-stat-item">
            <span className="timeline-stat-value">{timePoints.length}</span>
            <span className="timeline-stat-unit">节点</span>
          </span>
          <span className="timeline-divider" style={{ opacity: 0.2 }}>|</span>
          <span className="timeline-stat-item">
            <span className="timeline-stat-value">{totalChanges}</span>
            <span className="timeline-stat-unit">变动</span>
          </span>
        </div>

        {/* 右：快捷键提示 */}
        <span className="timeline-hotkey-badge">快捷键 ← → Home End</span>
      </div>

      {/* ── ECharts 图表 ── */}
      <ReactECharts
        option={option}
        style={{
          height: chartHeight,
          transition: prefersReducedMotion ? 'none' : 'height 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onEvents={onEvents}
        notMerge
      />

      {/* ── 底部控制栏 ── */}
      <div className="timeline-footer">
        {/* 左：当前节点信息 */}
        <div className="timeline-current">
          <span className="timeline-pulse-dot" />
          <span className="timeline-node-index">#{selectedIndex + 1}</span>
          <span className="timeline-node-time">
            {selectedTP?.timestamp.toLocaleString('zh-CN')}
          </span>
          {selectedChangeCount > 0 && (
            <div className="timeline-change-badges">
              {selectedCreateCount > 0 && (
                <span className="timeline-badge timeline-badge--create">+{selectedCreateCount}</span>
              )}
              {selectedUpdateCount > 0 && (
                <span className="timeline-badge timeline-badge--update">~{selectedUpdateCount}</span>
              )}
              {selectedDeleteCount > 0 && (
                <span className="timeline-badge timeline-badge--delete">-{selectedDeleteCount}</span>
              )}
            </div>
          )}
        </div>

        {/* 中：进度条区域 */}
        <div className="timeline-progress-area">
          <span className="timeline-progress-time timeline-progress-time--start">
            {firstTP ? formatTimeShort(firstTP.timestamp) : ''}
          </span>
          <div className="timeline-progress-track">
            <div
              className="timeline-progress-fill"
              style={{ width: `${progress}%` }}
            />
            {/* 进度光标 */}
            <div
              className="timeline-progress-thumb"
              style={{ left: `${progress}%` }}
            />
          </div>
          <span className="timeline-progress-time timeline-progress-time--end">
            {lastTP ? formatTimeShort(lastTP.timestamp) : ''}
          </span>
          <span className="timeline-progress-pct">{progress}%</span>
        </div>

        {/* 右：导航按钮 */}
        <div className="timeline-nav">
          <NavButton onClick={onFirst} disabled={isFirst} title="跳到开头 (Home)" icon={<IconFirst />} />
          <NavButton onClick={onPrev} disabled={filteredTimePoints.length === 0 || filteredTimePoints[0].index >= selectedIndex} title="上一个 (←)" icon={<IconPrev />} />
          <NavButton onClick={onNext} disabled={filteredTimePoints.length === 0 || filteredTimePoints[filteredTimePoints.length - 1].index <= selectedIndex} title="下一个 (→)" icon={<IconNext />} />
          <NavButton onClick={onLast} disabled={isLast} title="跳到末尾 (End)" icon={<IconLast />} />
        </div>
      </div>

      {/* ── 内联 CSS ── */}
      <style>{`
        /* === 容器 === */
        .timeline-root {
          background: var(--bg-card);
          border-bottom: 1px solid var(--border);
          position: relative;
        }

        /* === 顶部信息栏 === */
        .timeline-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 20px 0;
        }
        .timeline-stats {
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .timeline-label {
          color: var(--text-muted);
          font-size: 9px;
          font-family: var(--font-mono);
          letter-spacing: 0.12em;
          font-weight: 600;
          opacity: 0.7;
        }
        .timeline-divider {
          color: var(--text-muted);
          font-size: 10px;
          opacity: 0.3;
        }
        .timeline-stat-item {
          display: flex;
          align-items: baseline;
          gap: 3px;
        }
        .timeline-stat-value {
          color: var(--text-secondary);
          font-size: 11px;
          font-family: var(--font-mono);
          font-weight: 600;
        }
        .timeline-stat-unit {
          color: var(--text-muted);
          font-size: 9px;
          font-family: var(--font-mono);
        }
        .timeline-hotkey-badge {
          font-size: 9px;
          color: var(--text-muted);
          background: rgba(142, 164, 210, 0.06);
          border: 1px solid rgba(142, 164, 210, 0.14);
          border-radius: 3px;
          padding: 1px 7px;
          font-family: var(--font-mono);
          letter-spacing: 0.03em;
          opacity: 0.8;
        }

        /* === 底部控制栏 === */
        .timeline-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2px 20px 10px;
          gap: 12px;
        }

        /* === 当前节点信息 === */
        .timeline-current {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          flex: 1;
        }
        .timeline-node-index {
          color: ${SELECTED_COLOR};
          font-size: 11px;
          font-weight: 700;
          font-family: var(--font-mono);
          white-space: nowrap;
        }
        .timeline-node-time {
          color: var(--text-secondary);
          font-size: 10px;
          font-family: var(--font-mono);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .timeline-change-badges {
          display: flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
        }
        .timeline-badge {
          font-size: 9px;
          font-family: var(--font-mono);
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 3px;
          white-space: nowrap;
          letter-spacing: 0.02em;
        }
        .timeline-badge--create {
          color: ${COLOR_CREATE};
          background: var(--color-create-bg);
          border: 1px solid var(--color-create-border);
        }
        .timeline-badge--update {
          color: ${COLOR_UPDATE};
          background: var(--color-update-bg);
          border: 1px solid var(--color-update-border);
        }
        .timeline-badge--delete {
          color: ${COLOR_DELETE};
          background: var(--color-delete-bg);
          border: 1px solid var(--color-delete-border);
        }

        /* === 进度条区域 === */
        .timeline-progress-area {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .timeline-progress-time {
          color: var(--text-muted);
          font-size: 9px;
          font-family: var(--font-mono);
          white-space: nowrap;
          opacity: 0.7;
        }
        .timeline-progress-track {
          width: 100px;
          height: 4px;
          background: var(--bg-tertiary);
          border-radius: 2px;
          overflow: visible;
          position: relative;
        }
        .timeline-progress-fill {
          position: absolute;
          left: 0;
          top: 0;
          height: 100%;
          background: linear-gradient(90deg, ${SELECTED_COLOR}, ${SELECTED_LIGHT});
          border-radius: 2px;
          transition: width 0.2s ease-out;
          min-width: 0;
        }
        .timeline-progress-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${SELECTED_LIGHT};
          box-shadow: 0 0 0 3px rgba(169, 187, 223, 0.12);
          transition: left 0.2s ease-out;
          pointer-events: none;
        }
        .timeline-progress-pct {
          color: var(--text-muted);
          font-size: 9px;
          font-family: var(--font-mono);
          min-width: 28px;
          text-align: right;
          opacity: 0.7;
        }

        /* === 导航按钮 === */
        .timeline-nav {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .timeline-nav-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 28px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text-muted);
          font-size: 11px;
          cursor: pointer;
          transition:
            background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1),
            border-color 0.15s cubic-bezier(0.16, 1, 0.3, 1),
            color 0.15s cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow 0.15s cubic-bezier(0.16, 1, 0.3, 1),
            transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
          line-height: 1;
          user-select: none;
          flex-shrink: 0;
        }
        .timeline-nav-btn:not(:disabled):hover {
          background: var(--bg-card-hover);
          border-color: var(--border-strong);
          color: ${SELECTED_COLOR};
          box-shadow: var(--shadow-sm);
        }
        .timeline-nav-btn:not(:disabled):active {
          transform: translateY(0);
          box-shadow: none;
        }
        .timeline-nav-btn:disabled {
          opacity: 0.25;
          cursor: not-allowed;
        }

        /* === 脉冲圆点 === */
        .timeline-pulse-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${SELECTED_COLOR};
          flex-shrink: 0;
          position: relative;
          box-shadow: 0 0 0 3px rgba(169, 187, 223, 0.12);
        }
        @media (prefers-reduced-motion: reduce) {
          .timeline-pulse-dot { animation: none; }
          .timeline-progress-fill,
          .timeline-progress-thumb,
          .timeline-nav-btn { transition: none; }
          .timeline-nav-btn:not(:disabled):hover { transform: none; }
        }
      `}</style>
    </div>
  );
};

/** 精致导航按钮 — SVG 图标 */
const NavButton: React.FC<{
  onClick: () => void;
  disabled: boolean;
  title: string;
  icon: React.ReactNode;
}> = ({ onClick, disabled, title, icon }) => (
  <button
    className="timeline-nav-btn"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
  >
    {icon}
  </button>
);
