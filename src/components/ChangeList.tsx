// src/components/ChangeList.tsx
import React from 'react';
import { Table, Tooltip } from 'antd';
import type { ArchiveChange, TimePoint } from '../types';

interface ChangeListProps {
  timePoint: TimePoint | null;
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
}

const CHANGE_TYPE_CONFIG = {
  create: { label: '新增', color: 'var(--color-create)', bg: 'var(--color-create-bg)' },
  update: { label: '修改', color: 'var(--color-update)', bg: 'var(--color-update-bg)' },
  delete: { label: '删除', color: 'var(--color-delete)', bg: 'var(--color-delete-bg)' },
  noop: { label: '未变', color: 'var(--text-muted)', bg: 'rgba(148, 163, 184, 0.15)' },
};


function formatLimitMetadata(metadata: ArchiveChange['limitMetadata']): string {
  if (!metadata) return '';
  return `当前存档本周期内累计获得值已经从 ${metadata.dayValueOld} 变成了 ${metadata.dayValueNew}；本周期允许累计的上限是 ${metadata.maxValue}`;
}

export const ChangeList: React.FC<ChangeListProps> = ({ timePoint, selectedKey, onSelectKey }) => {
  if (!timePoint) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        选择时间节点以查看变动
      </div>
    );
  }

  const columns = [
    {
      title: '类型',
      dataIndex: 'changeType',
      width: 60,
      render: (type: ArchiveChange['changeType']) => {
        const config = CHANGE_TYPE_CONFIG[type];
        return (
          <span
            style={{
              color: config.color,
              background: config.bg,
              padding: '1px 6px',
              borderRadius: 2,
              fontSize: 11,
            }}
          >
            {config.label}
          </span>
        );
      },
    },
    {
      title: '存档键',
      dataIndex: 'key',
      ellipsis: true,
      render: (key: string) => <span style={{ color: 'var(--accent-blue)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{key}</span>,
    },
    {
      title: '旧值',
      dataIndex: 'oldValue',
      width: 120,
      ellipsis: true,
      render: (v: string) => (
        <span style={{ color: v === 'nil' ? 'var(--text-muted)' : 'var(--color-delete)', fontSize: 11 }}>
          {v}
        </span>
      ),
    },
    {
      title: '',
      width: 24,
      render: () => <span style={{ color: 'var(--color-update)' }}>→</span>,
    },
    {
      title: '新值',
      dataIndex: 'newValue',
      width: 120,
      ellipsis: true,
      render: (v: string) => (
        <span style={{ color: v === 'nil' ? 'var(--text-muted)' : 'var(--color-create)', fontSize: 11 }}>
          {v}
        </span>
      ),
    },
    {
      title: '限制',
      dataIndex: 'limitMetadata',
      width: 190,
      ellipsis: true,
      render: (metadata: ArchiveChange['limitMetadata']) => metadata ? (
        <Tooltip title={formatLimitMetadata(metadata)} placement="topLeft" styles={{ container: { fontSize: 11 } }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            用量: {metadata.dayValueOld} → {metadata.dayValueNew} / 上限: {metadata.maxValue}
          </span>
        </Tooltip>
      ) : (
        <span style={{ color: 'var(--text-muted)', opacity: 0.45 }}>—</span>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          background: 'var(--bg-secondary)',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>变动列表</span>
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--border)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {timePoint.timestamp.toLocaleString('zh-CN')}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          padding: '1px 6px',
          background: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          borderRadius: 3,
          color: 'var(--accent-blue)',
        }}>
          {timePoint.changes.length} 条
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Table
          dataSource={timePoint.changes}
          columns={columns}
          rowKey={(record, index) => `${record.key}-${record.changeType}-${index}`}
          size="small"
          pagination={false}
          rowClassName={(record) => (record.key === selectedKey ? 'row-selected' : '')}
          onRow={(record) => ({
            onClick: () => onSelectKey(record.key),
            style: {
              cursor: 'pointer',
              background: record.key === selectedKey ? 'var(--accent-blue-dim)' : undefined,
              borderLeft: record.key === selectedKey ? '3px solid var(--accent-blue)' : '3px solid transparent',
              opacity: record.changeType === 'noop' ? 0.5 : undefined,
            },
          })}
          style={{ fontSize: 11 }}
        />
      </div>
    </div>
  );
};
