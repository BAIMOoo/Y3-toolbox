// src/components/SnapshotView.tsx
import React, { useState } from 'react';
import { Tooltip } from 'antd';
import type { Snapshot, ArchiveChange, DisplayMode } from '../types';
import { DiffView } from './DiffView';
import { TreeView } from './TreeView';

interface SnapshotViewProps {
  prevSnapshot: Snapshot;
  currentSnapshot: Snapshot;
  changes: ArchiveChange[];
  highlightKey: string | null;
}

type ViewMode = 'diff' | 'tree';

const modeButtonStyle = (active: boolean): React.CSSProperties => ({
  padding: '5px 11px',
  minHeight: 28,
  background: active ? 'var(--accent-blue-dim)' : 'transparent',
  color: active ? 'var(--accent-blue-strong)' : 'var(--text-secondary)',
  border: active ? '1px solid rgba(142, 164, 210, 0.32)' : '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  fontSize: 10,
  fontWeight: active ? 650 : 500,
  cursor: 'pointer',
  letterSpacing: '0.02em',
});

export const SnapshotView: React.FC<SnapshotViewProps> = ({
  prevSnapshot,
  currentSnapshot,
  changes,
  highlightKey,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('diff');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('diff');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 标题栏 */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '8px 12px',
          color: 'var(--text-secondary)',
          fontSize: 11,
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 650, color: 'var(--text-primary)' }}>
          快照对比
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <Tooltip title="显示所有根键及其全部内容" placement="bottom">
              <button
                onClick={() => setDisplayMode('all')}
                className="view-mode-button"
                style={modeButtonStyle(displayMode === 'all')}
                aria-label="全部"
              >
                全部
              </button>
            </Tooltip>
            <Tooltip title="只显示发生变化的根键和值" placement="bottom">
              <button
                onClick={() => setDisplayMode('diff')}
                className="view-mode-button"
                style={modeButtonStyle(displayMode === 'diff')}
                aria-label="仅变动"
              >
                仅变动
              </button>
            </Tooltip>
            <Tooltip title="只显示有变动的根键，并保留相关上下文" placement="bottom">
              <button
                onClick={() => setDisplayMode('context')}
                className="view-mode-button"
                style={modeButtonStyle(displayMode === 'context')}
                aria-label="变动上下文"
              >
                变动+上下文
              </button>
            </Tooltip>
          </div>
          {/* 竖线分隔两组功能按钮 */}
          <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              className="view-mode-button"
              onClick={() => setViewMode('diff')}
              style={modeButtonStyle(viewMode === 'diff')}
              aria-label="左右对比模式"
            >
              左右对比
            </button>
            <button
              className="view-mode-button"
              onClick={() => setViewMode('tree')}
              style={modeButtonStyle(viewMode === 'tree')}
              aria-label="树形查看模式"
            >
              树形查看
            </button>
          </div>
        </div>
      </div>
      {/* 视图内容 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {viewMode === 'diff' ? (
          <DiffView
            prevSnapshot={prevSnapshot}
            currentSnapshot={currentSnapshot}
            changes={changes}
            highlightKey={highlightKey}
            displayMode={displayMode}
          />
        ) : (
          <TreeView snapshot={currentSnapshot} changes={changes} highlightKey={highlightKey} />
        )}
      </div>
    </div>
  );
};
