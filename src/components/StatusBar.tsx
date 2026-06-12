// src/components/StatusBar.tsx
import React, { useMemo } from 'react';
import type { Snapshot, SnapshotValue } from '../types';

interface StatusBarProps {
  fileName: string | null;
  timePointCount: number;
  selectedIndex: number;
  currentSnapshot: Snapshot;
  currentChanges: { creates: number; updates: number; deletes: number; noops: number };
}

function countKeys(obj: Record<string, SnapshotValue>): number {
  let count = 0;
  for (const key of Object.keys(obj)) {
    count++;
    const val = obj[key];
    if (typeof val === 'object' && val !== null) {
      count += countKeys(val);
    }
  }
  return count;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  fileName,
  timePointCount,
  selectedIndex,
  currentSnapshot,
  currentChanges,
}) => {
  // memoize 递归计算
  const keyCount = useMemo(() => countKeys(currentSnapshot), [currentSnapshot]);

  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        padding: '4px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: 'var(--text-muted)',
        fontSize: 10,
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* 左侧：文件信息分组 */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {fileName ? (
          <>
            <span style={{ padding: '0 8px 0 0' }}>{fileName}</span>
            <span style={{ borderLeft: '1px solid var(--border)', padding: '0 8px' }}>{timePointCount} 节点</span>
            <span style={{ borderLeft: '1px solid var(--border)', padding: '0 8px' }}>#{selectedIndex + 1} / {timePointCount}</span>
            <span style={{ borderLeft: '1px solid var(--border)', padding: '0 8px' }}>存档键 {keyCount}</span>
          </>
        ) : (
          <span>未加载文件</span>
        )}
      </div>
      {/* 右侧：变动计数 badge */}
      {fileName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            padding: '0 5px', height: 16, lineHeight: '16px', borderRadius: 3,
            background: 'var(--status-bg-create)', color: 'var(--status-color-create)',
            fontWeight: 600,
          }}>+{currentChanges.creates}</span>
          <span style={{
            padding: '0 5px', height: 16, lineHeight: '16px', borderRadius: 3,
            background: 'var(--status-bg-update)', color: 'var(--status-color-update)',
            fontWeight: 600,
          }}>~{currentChanges.updates}</span>
          <span style={{
            padding: '0 5px', height: 16, lineHeight: '16px', borderRadius: 3,
            background: 'var(--status-bg-delete)', color: 'var(--status-color-delete)',
            fontWeight: 600,
          }}>-{currentChanges.deletes}</span>
          {currentChanges.noops > 0 && (
            <span style={{
              padding: '0 5px', height: 16, lineHeight: '16px', borderRadius: 3,
              background: 'rgba(148, 163, 184, 0.1)', color: 'var(--text-muted)',
              fontWeight: 600,
            }}>⚬{currentChanges.noops}</span>
          )}
        </div>
      )}
    </div>
  );
};
