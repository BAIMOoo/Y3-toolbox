// src/components/DiffView.tsx
import React, { useRef, useCallback, useMemo, useState } from 'react';
import { Tooltip } from 'antd';
import type { Snapshot, ArchiveChange, SnapshotValue, DisplayMode } from '../types';
import { buildAlignedLines } from '../engine/diffLines';
import { computeVisibleLines } from '../engine/filterDiffLines';
import type { DiffLine, DiffLineContent } from '../engine/diffLines';

interface DiffViewProps {
  prevSnapshot: Snapshot;
  currentSnapshot: Snapshot;
  changes: ArchiveChange[];
  highlightKey: string | null;
  displayMode?: DisplayMode;
}

/** 行高样式常量 */
const LINE_STYLE = {
  minHeight: 21,
  padding: '1px 6px',
  lineHeight: 1.6,
  fontSize: 11,
} as const;

const SNAPSHOT_COMPARE_COLOR_VERSION = 'snapshot-compare-status-v10-themed-paper-contrast';

/** 根据行类型和侧面返回背景色 */
function getLeftBgColor(type: DiffLine['type'], fullKey: string | undefined, highlightKey: string | null): string {
  if (fullKey && highlightKey === fullKey) return 'var(--highlight-bg)';
  switch (type) {
    case 'deleted': return 'var(--snapshot-compare-bg-delete)';
    case 'updated': return 'var(--snapshot-compare-bg-update)';
    case 'noop': return 'rgba(104, 115, 133, 0.04)';
    default: return 'transparent';
  }
}

function getRightBgColor(type: DiffLine['type'], fullKey: string | undefined, highlightKey: string | null): string {
  if (fullKey && highlightKey === fullKey) return 'var(--highlight-bg)';
  switch (type) {
    case 'created': return 'var(--snapshot-compare-bg-create)';
    case 'updated': return 'var(--snapshot-compare-bg-update)';
    case 'deleted': return 'var(--snapshot-compare-bg-delete)';
    case 'noop': return 'rgba(104, 115, 133, 0.04)';
    default: return 'transparent';
  }
}

/** 获取左侧文本颜色 */
function getLeftTextColor(type: DiffLine['type']): string {
  switch (type) {
    case 'deleted': return 'var(--snapshot-compare-color-delete)';
    case 'updated': return 'var(--snapshot-compare-color-update)';
    case 'noop': return 'var(--text-muted)';
    default: return 'var(--text-primary)';
  }
}

/** 获取右侧文本颜色 */
function getRightTextColor(type: DiffLine['type']): string {
  switch (type) {
    case 'created': return 'var(--snapshot-compare-color-create)';
    case 'updated': return 'var(--snapshot-compare-color-update)';
    case 'deleted': return 'var(--snapshot-compare-color-delete)';
    case 'noop': return 'var(--text-muted)';
    default: return 'var(--text-primary)';
  }
}

type LimitMetadata = ArchiveChange['limitMetadata'];

function formatLimitMetadata(metadata: LimitMetadata): string {
  if (!metadata) return '';
  return `当前存档本周期内累计获得值已经从 ${metadata.dayValueOld} 变成了 ${metadata.dayValueNew}；本周期允许累计的上限是 ${metadata.maxValue}`;
}

function renderLimitMetadata(metadata: LimitMetadata): React.ReactNode {
  if (!metadata) return null;
  return (
    <Tooltip title={formatLimitMetadata(metadata)} placement="topLeft" styles={{ container: { fontSize: 11 } }}>
      <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 10 }}>
        用量 {metadata.dayValueOld}→{metadata.dayValueNew} / 上限 {metadata.maxValue}
      </span>
    </Tooltip>
  );
}

/** 渲染单侧行内容 */
function renderContent(
  content: DiffLineContent | null,
  type: DiffLine['type'],
  side: 'left' | 'right',
  bgColor: string,
  textColor: string,
  isDeleted: boolean,
  limitMetadata?: LimitMetadata,
): React.ReactNode {
  if (!content) {
    // 占位空行
    return (
      <div style={{
        ...LINE_STYLE,
        paddingLeft: 4,
        background: 'transparent',
        borderLeft: '2px solid transparent',
      }}>
        {'\u00A0'}
      </div>
    );
  }

  const indent = content.indent * 16;
  const style: React.CSSProperties = {
    ...LINE_STYLE,
    paddingLeft: indent + 4,
    background: bgColor,
    borderLeft: type === 'created' ? '2px solid var(--snapshot-compare-color-create)'
      : type === 'deleted' ? '2px solid var(--snapshot-compare-color-delete)'
      : type === 'updated' ? '2px solid var(--snapshot-compare-color-update)'
      : type === 'noop' ? '2px solid var(--text-muted)'
      : '2px solid transparent',
  };

  if (isDeleted) {
    style.opacity = 0.5;
    style.textDecoration = 'line-through';
  }

  if (type === 'noop') {
    style.opacity = 0.5;
  }

  if (content.isObjectStart) {
    return (
      <div style={style}>
        <span style={{ color: textColor }}>{content.text}</span>{' '}
        <span style={{ color: 'var(--text-muted)' }}>{'{'}</span>
      </div>
    );
  }

  if (content.isObjectEnd) {
    return (
      <div style={style}>
        <span style={{ color: 'var(--text-muted)' }}>{'}'}</span>
      </div>
    );
  }

  // 普通键值行: "key: value"
  const colonIdx = content.text.indexOf(': ');
  const keyPart = colonIdx >= 0 ? content.text.slice(0, colonIdx) : content.text;
  const valPart = colonIdx >= 0 ? content.text.slice(colonIdx + 2) : '';

  return (
    <div style={style}>
      <span style={{ color: type !== 'unchanged' ? textColor : 'var(--text-secondary)' }}>
        {keyPart}:
      </span>{' '}
      <span style={{ color: type !== 'unchanged' ? textColor : 'var(--text-primary)' }}>
        {valPart}
      </span>
      {side === 'right' && !isDeleted && renderLimitMetadata(limitMetadata)}
    </div>
  );
}

/** 折叠标题行 */
function renderFoldHeader(
  content: DiffLineContent,
  childCount: number,
  collapsed: boolean,
  onToggle: () => void,
): React.ReactNode {
  const indent = content.indent * 16;
  return (
    <div
      style={{
        ...LINE_STYLE,
        paddingLeft: indent + 4,
        background: 'rgba(142, 164, 210, 0.08)',
        cursor: 'pointer',
      }}
      onClick={onToggle}
    >
      <span style={{ color: 'var(--accent-blue)', marginRight: 5, fontSize: 10 }}>
        {collapsed ? '▶' : '▼'}
      </span>
      <span style={{ color: 'var(--text-primary)' }}>{content.text}</span>{' '}
      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
        {collapsed ? `{ … ${childCount} 项 }` : '{'}
      </span>
    </div>
  );
}

export const DiffView: React.FC<DiffViewProps> = ({ prevSnapshot, currentSnapshot, changes, highlightKey, displayMode = 'diff' }) => {
  const changedKeys = useMemo(() => new Set(changes.map((c) => c.key)), [changes]);
  const noopKeys = useMemo(() => new Set(changes.filter((c) => c.changeType === 'noop').map((c) => c.key)), [changes]);
  const limitMetadataByKey = useMemo(() => {
    const map = new Map<string, NonNullable<ArchiveChange['limitMetadata']>>();
    for (const change of changes) {
      if (change.limitMetadata) map.set(change.key, change.limitMetadata);
    }
    return map;
  }, [changes]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false); // 防止循环触发

  // oldValue（>>>前的值）表示变动前该 key 已存在于存档中。
  // 如果 prevSnapshot 中缺少该 key（日志不是从最初开始），用 oldValue 回填。
  const patchedPrevSnapshot = useMemo(() => {
    const backfills = changes.filter((c) => c.oldValue !== 'nil');
    if (backfills.length === 0) return prevSnapshot;
    const patched = JSON.parse(JSON.stringify(prevSnapshot));
    for (const change of backfills) {
      // 检查 key 是否已存在
      let current: SnapshotValue = patched;
      let missing = false;
      for (const part of change.keyParts) {
        if (current === undefined || current === null || typeof current !== 'object' || !(part in current)) {
          missing = true;
          break;
        }
        current = (current as Record<string, SnapshotValue>)[part];
      }
      if (missing) {
        // 回填：沿 keyParts 创建路径并写入 oldValue
        let node: Record<string, SnapshotValue> = patched;
        for (let i = 0; i < change.keyParts.length - 1; i++) {
          const part = change.keyParts[i];
          if (node[part] === undefined || typeof node[part] !== 'object') {
            node[part] = {};
          }
          node = node[part] as Record<string, SnapshotValue>;
        }
        const lastKey = change.keyParts[change.keyParts.length - 1];
        if (change.oldValue === '{}') {
          if (node[lastKey] === undefined) node[lastKey] = {};
        } else {
          node[lastKey] = change.oldValue;
        }
      }
    }
    return patched;
  }, [prevSnapshot, changes]);

  // 生成统一行列表
  const lines = useMemo(
    () => buildAlignedLines(patchedPrevSnapshot, currentSnapshot, changedKeys, noopKeys),
    [patchedPrevSnapshot, currentSnapshot, changedKeys, noopKeys],
  );

  // 默认折叠的 foldId 集合（所有可折叠的子树）
  const defaultFoldIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of lines) {
      if (line.foldId) ids.add(line.foldId);
    }
    return ids;
  }, [lines]);

  // 用户手动展开的 foldId 集合
  // 使用 lines 的序列化 key 来检测 lines 变化并重置展开状态
  const linesKey = useMemo(() => lines.length + '-' + [...defaultFoldIds].join(','), [lines.length, defaultFoldIds]);
  const [expandedState, setExpandedState] = useState<{ key: string; expanded: Set<string> }>({ key: '', expanded: new Set() });

  // 当 lines 变化时自动重置
  const expandedFolds = useMemo(() => {
    return expandedState.key === linesKey ? expandedState.expanded : new Set<string>();
  }, [expandedState, linesKey]);

  // 实际的折叠集合 = 默认折叠 - 用户展开
  const collapsedFolds = useMemo(() => {
    const result = new Set(defaultFoldIds);
    for (const id of expandedFolds) {
      result.delete(id);
    }
    return result;
  }, [defaultFoldIds, expandedFolds]);

  // 计算每个 foldId 对应的子键数量（用于折叠摘要显示）
  const foldChildCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      if (line.foldId && !line.isFoldHeader && !line.left?.isObjectEnd && !line.right?.isObjectEnd) {
        counts.set(line.foldId, (counts.get(line.foldId) || 0) + 1);
      }
    }
    return counts;
  }, [lines]);

  // 过滤可见行
  const visibleLines = useMemo(() => {
    return computeVisibleLines(lines, displayMode, collapsedFolds);
  }, [lines, collapsedFolds, displayMode]);

  const toggleFold = useCallback((foldId: string) => {
    setExpandedState(prev => {
      const next = new Set(prev.key === linesKey ? prev.expanded : new Set<string>());
      if (next.has(foldId)) {
        next.delete(foldId);
      } else {
        next.add(foldId);
      }
      return { key: linesKey, expanded: next };
    });
  }, [linesKey]);

  // 双向同步滚动
  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const from = source === 'left' ? leftRef.current : rightRef.current;
    const to = source === 'left' ? rightRef.current : leftRef.current;
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  }, []);

  return (
    <div
      data-snapshot-compare-version={SNAPSHOT_COMPARE_COLOR_VERSION}
      style={{ display: 'flex', height: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.62, background: 'var(--bg-primary)' }}
    >
      {/* 左面板 */}
      <div
        ref={leftRef}
        onScroll={() => syncScroll('left')}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg-primary)' }}
      >
        <div style={{ padding: 8 }}>
          <div style={{
            color: 'var(--snapshot-compare-color-delete)', fontSize: 10, marginBottom: 6, paddingBottom: 4,
            borderBottom: '1px solid var(--snapshot-compare-border-delete)',
            position: 'sticky', top: 0,
            background: 'var(--bg-tertiary)',
            zIndex: 1,
          }}>
            ◀ 前一时刻
          </div>
          {visibleLines.map((line, i) => {
            // 折叠标题行
            if (line.isFoldHeader && line.foldId) {
              const content = line.left || line.right!;
              const collapsed = collapsedFolds.has(line.foldId);
              return (
                <div key={`left-${i}`}>
                  {renderFoldHeader(
                    content,
                    foldChildCounts.get(line.foldId) || 0,
                    collapsed,
                    () => toggleFold(line.foldId!),
                  )}
                </div>
              );
            }
            const bgColor = getLeftBgColor(line.type, line.left?.fullKey, highlightKey);
            const textColor = getLeftTextColor(line.type);
            return (
              <div key={`left-${i}`}>
                {renderContent(line.left, line.type, 'left', bgColor, textColor, false, limitMetadataByKey.get(line.left?.fullKey ?? ''))}
              </div>
            );
          })}
        </div>
      </div>

      {/* 右面板 */}
      <div
        ref={rightRef}
        onScroll={() => syncScroll('right')}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', borderLeft: '1px solid var(--border)' }}
      >
        <div style={{ padding: 8 }}>
          <div style={{
            color: 'var(--snapshot-compare-color-create)', fontSize: 10, marginBottom: 6, paddingBottom: 4,
            borderBottom: '1px solid var(--snapshot-compare-border-create)',
            position: 'sticky', top: 0,
            background: 'var(--bg-tertiary)',
            zIndex: 1,
          }}>
            当前时刻 ▶
          </div>
          {visibleLines.map((line, i) => {
            // 折叠标题行
            if (line.isFoldHeader && line.foldId) {
              const content = line.right || line.left!;
              const collapsed = collapsedFolds.has(line.foldId);
              return (
                <div key={`right-${i}`}>
                  {renderFoldHeader(
                    content,
                    foldChildCounts.get(line.foldId) || 0,
                    collapsed,
                    () => toggleFold(line.foldId!),
                  )}
                </div>
              );
            }
            const isDeletedGhost = line.type === 'deleted';
            const bgColor = getRightBgColor(line.type, line.right?.fullKey, highlightKey);
            const textColor = getRightTextColor(line.type);
            return (
              <div key={`right-${i}`}>
                {renderContent(line.right, line.type, 'right', bgColor, textColor, isDeletedGhost, limitMetadataByKey.get(line.right?.fullKey ?? ''))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
