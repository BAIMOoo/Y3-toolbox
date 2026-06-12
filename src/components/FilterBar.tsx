// src/components/FilterBar.tsx
import React, { useCallback, useRef } from 'react';
import { Select, Input, DatePicker, Tooltip } from 'antd';
import { SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import type { FilterState, ChangeType } from '../types';
import { FileUpload } from './FileUpload';

const { RangePicker } = DatePicker;

interface FilterBarProps {
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  availableRootKeys: string[];
  onFileSelected: (file: File) => void;
  loading: boolean;
  fileName: string | null;
  onDownloadClean?: () => void;
}

const CHANGE_TYPE_OPTIONS: { value: ChangeType; label: string; color: string; icon: string }[] = [
  { value: 'create', label: '新增', color: 'var(--color-create)', icon: '+' },
  { value: 'update', label: '修改', color: 'var(--color-update)', icon: '~' },
  { value: 'delete', label: '删除', color: 'var(--color-delete)', icon: '-' },
  { value: 'noop', label: '未变', color: 'var(--text-muted)', icon: '·' },
];

/** 搜索输入组件（防抖 300ms），用非受控 input 避免 useEffect+setState */
const DebouncedSearchInput: React.FC<{
  defaultValue: string;
  onSearch: (value: string) => void;
}> = ({ defaultValue, onSearch }) => {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((value: string) => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(value), 300);
  }, [onSearch]);

  return (
    <Input
      key={defaultValue} // 外部重置时通过 key 重建
      placeholder="搜索键名或值"
      prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
      defaultValue={defaultValue}
      onChange={(e) => handleChange(e.target.value)}
      onClear={() => { if (debounceRef.current !== null) clearTimeout(debounceRef.current); onSearch(''); }}
      style={{ width: 220, fontFamily: 'var(--font-mono)' }}
      allowClear
      size="small"
    />
  );
};

export const FilterBar: React.FC<FilterBarProps> = ({
  filter,
  onFilterChange,
  availableRootKeys,
  onFileSelected,
  loading,
  fileName,
  onDownloadClean,
}) => {

  const handleSearch = useCallback(
    (keyword: string) => onFilterChange({ ...filter, searchKeyword: keyword }),
    [filter, onFilterChange],
  );

  return (
    <div className="diff-context-toolbar" aria-label="变动日志筛选工具栏">
      <div className="diff-context-toolbar__row">
        <div className="diff-context-toolbar__meta">
          <span style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--accent-blue)',
            boxShadow: '0 0 0 3px var(--accent-blue-dim)',
          }} />
          <div>
            <div style={{
              fontSize: 12,
              fontWeight: 650,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
              letterSpacing: '0.02em',
            }}>
              变动日志工作台
            </div>
            <div style={{
              color: 'var(--text-muted)',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              marginTop: 2,
            }}>
              {fileName ?? '未选择文件'}
            </div>
          </div>
        </div>

        <div className="diff-context-toolbar__filters">
          <RangePicker
            showTime
            placeholder={['开始时间', '结束时间']}
            onChange={(dates) => {
              onFilterChange({
                ...filter,
                timeRange: dates && dates[0] && dates[1]
                  ? [dates[0].toDate(), dates[1].toDate()]
                  : null,
              });
            }}
            size="small"
            style={{ width: 284 }}
          />

          <Select
            mode="multiple"
            placeholder="存档键"
            value={filter.rootKeys}
            onChange={(rootKeys) => onFilterChange({ ...filter, rootKeys })}
            options={availableRootKeys.map((k) => ({ value: k, label: k }))}
            style={{ minWidth: 132 }}
            allowClear
            maxTagCount={2}
            size="small"
          />

          <Select
            mode="multiple"
            placeholder="变动类型"
            value={filter.changeTypes}
            onChange={(changeTypes) => onFilterChange({ ...filter, changeTypes })}
            style={{ minWidth: 138 }}
            allowClear
            size="small"
          >
            {CHANGE_TYPE_OPTIONS.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                <span style={{ fontFamily: 'var(--font-mono)', marginRight: 5, color: opt.color, fontWeight: 650 }}>
                  {opt.icon}
                </span>
                <span style={{ color: opt.color }}>{opt.label}</span>
              </Select.Option>
            ))}
          </Select>

          <DebouncedSearchInput
            defaultValue={filter.searchKeyword}
            onSearch={handleSearch}
          />
        </div>

        <div className="diff-context-toolbar__actions">
          <FileUpload onFileSelected={onFileSelected} loading={loading} fileName={fileName} variant="toolbar" />
          <div style={{ width: 1, height: 22, background: 'var(--border)', flexShrink: 0 }} />
          <Tooltip title="下载整理后的 CSV">
            <button
              type="button"
              onClick={fileName && !loading && onDownloadClean ? onDownloadClean : undefined}
              disabled={!fileName || loading || !onDownloadClean}
              aria-label="下载整理后的 CSV"
              className="icon-action-button"
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                fontSize: 13,
                cursor: fileName && !loading && onDownloadClean ? 'pointer' : 'not-allowed',
                opacity: fileName && !loading && onDownloadClean ? 1 : 0.45,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                visibility: onDownloadClean ? 'visible' : 'hidden',
              }}
            >
              <DownloadOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
