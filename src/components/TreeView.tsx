// src/components/TreeView.tsx
import React, { useState, useMemo } from 'react';
import type { Snapshot, ArchiveChange, SnapshotValue } from '../types';

interface TreeViewProps {
  snapshot: Snapshot;
  changes: ArchiveChange[];
  highlightKey: string | null;
}

interface TreeNodeProps {
  nodeKey: string;
  fullKey: string;
  value: SnapshotValue;
  changedKeys: Map<string, ArchiveChange['changeType']>;
  highlightKey: string | null;
  depth: number;
  isLast: boolean;
  parentGuides: boolean[]; // true = 该层祖先还有后续兄弟（画 │），false = 画空白
}

/** 引导线样式 */
const GUIDE_STYLE: React.CSSProperties = {
  color: 'var(--text-muted)',
  opacity: 0.32,
  userSelect: 'none',
};

/**
 * 构建引导线前缀。
 * parentGuides 记录每层祖先是否还有后续兄弟：
 *   true  → │   （竖线 + 空格）
 *   false →     （空格 * 4）
 * 最后加上当前节点的连接符：
 *   isLast  → └─
 *   !isLast → ├─
 */
function buildGuidePrefix(parentGuides: boolean[], isLast: boolean, depth: number): React.ReactNode {
  if (depth === 0) return null;

  const parts: string[] = [];
  for (const hasMore of parentGuides) {
    parts.push(hasMore ? '│  ' : '   ');
  }
  parts.push(isLast ? '└─ ' : '├─ ');

  return <span style={GUIDE_STYLE}>{parts.join('')}</span>;
}

const TreeNode: React.FC<TreeNodeProps> = ({ nodeKey, fullKey, value, changedKeys, highlightKey, depth, isLast, parentGuides }) => {
  const [expanded, setExpanded] = useState(true);
  const isObject = typeof value === 'object' && value !== null;
  const changeType = changedKeys.get(fullKey);
  const isHighlighted = highlightKey === fullKey;

  const color = changeType === 'create'
    ? 'var(--color-create)'
    : changeType === 'update'
      ? 'var(--color-update)'
      : changeType === 'delete'
        ? 'var(--color-delete)'
        : changeType === 'noop'
          ? 'var(--text-muted)'
          : 'var(--text-primary)';

  const bgColor = isHighlighted ? 'var(--highlight-bg)' : 'transparent';

  const prefix = changeType === 'create' ? '+ ' : changeType === 'update' ? '~ ' : changeType === 'delete' ? '- ' : changeType === 'noop' ? '· ' : '';

  // 子节点的 parentGuides：当前节点是否还有后续兄弟
  const childParentGuides = depth > 0 ? [...parentGuides, !isLast] : parentGuides;

  if (isObject) {
    const childKeys = Object.keys(value).sort();
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`${expanded ? '折叠' : '展开'} ${fullKey || nodeKey}`}
          className="tree-disclosure-button"
          style={{
            cursor: 'pointer',
            background: bgColor,
            padding: '2px 6px',
            color,
            whiteSpace: 'pre',
            display: 'block',
            width: '100%',
            textAlign: 'left',
            border: isHighlighted ? '1px solid rgba(142, 164, 210, 0.24)' : '1px solid transparent',
            borderRadius: 'var(--radius-sm)',
            font: 'inherit',
          }}
        >
          {buildGuidePrefix(parentGuides, isLast, depth)}
          <span aria-hidden="true" style={{ color: 'var(--text-muted)', marginRight: 4 }}>{expanded ? '▼' : '▶'}</span>
          {prefix}{nodeKey} {!expanded && <span style={{ color: 'var(--text-muted)' }}>({childKeys.length})</span>}
        </button>
        {expanded &&
          childKeys.map((k, i) => (
            <TreeNode
              key={k}
              nodeKey={k}
              fullKey={fullKey ? `${fullKey}-${k}` : k}
              value={value[k]}
              changedKeys={changedKeys}
              highlightKey={highlightKey}
              depth={depth + 1}
              isLast={i === childKeys.length - 1}
              parentGuides={childParentGuides}
            />
          ))}
      </div>
    );
  }

  return (
    <div style={{ background: bgColor, padding: '2px 6px', whiteSpace: 'pre', borderRadius: 'var(--radius-sm)' }}>
      {buildGuidePrefix(parentGuides, isLast, depth)}
      <span style={{ color }}>{prefix}{nodeKey}: {String(value)}</span>
    </div>
  );
};

export const TreeView: React.FC<TreeViewProps> = ({ snapshot, changes, highlightKey }) => {
  // memoize changedKeys Map 构建
  const changedKeys = useMemo(() => {
    const map = new Map<string, ArchiveChange['changeType']>();
    for (const c of changes) {
      map.set(c.key, c.changeType);
    }
    return map;
  }, [changes]);

  const rootKeys = Object.keys(snapshot).sort();

  return (
    <div style={{ padding: 10, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.65, overflow: 'auto', height: '100%', background: 'var(--bg-primary)' }}>
      {rootKeys.map((key, i) => (
        <TreeNode
          key={key}
          nodeKey={key}
          fullKey={key}
          value={snapshot[key]}
          changedKeys={changedKeys}
          highlightKey={highlightKey}
          depth={0}
          isLast={i === rootKeys.length - 1}
          parentGuides={[]}
        />
      ))}
      {rootKeys.length === 0 && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>空快照</div>
      )}
    </div>
  );
};
