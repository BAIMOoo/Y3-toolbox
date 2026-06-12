// src/components/EmptyState.tsx
import React, { useCallback, useState } from 'react';
import { InboxOutlined } from '@ant-design/icons';
import { message } from 'antd';
import { MAX_CSV_FILE_SIZE_BYTES, MAX_CSV_FILE_SIZE_MB } from '../constants/fileLimits';
import { isCsvPath } from '../utils/localInputContract';


function readDroppedFilePath(file: File | undefined): string {
  const path = (file as (File & { path?: unknown }) | undefined)?.path;
  return typeof path === 'string' ? path : '';
}

function isDroppedCsv(file: File | undefined): file is File {
  if (!file) return false;
  return isCsvPath(file.name) || isCsvPath(readDroppedFilePath(file));
}

interface EmptyStateProps {
  onFileSelected: (file: File) => void;
  loading: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onFileSelected, loading }) => {
  const [isDragging, setIsDragging] = useState(false);

  const validateAndSelect = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      message.error('仅支持 CSV 文件');
      return;
    }
    if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
      message.error(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 ${MAX_CSV_FILE_SIZE_MB}MB`);
      return;
    }
    onFileSelected(file);
  }, [onFileSelected]);

  const openFilePicker = useCallback(() => {
    if (loading) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) validateAndSelect(file);
    };
    input.click();
  }, [loading, validateAndSelect]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const file = e.dataTransfer.files[0];
    if (!isDroppedCsv(file)) {
      setIsDragging(false);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    validateAndSelect(file);
  }, [validateAndSelect]);

  return (
    <section className="empty-state-stage" aria-label="导入存档变动日志">
      <div
        role="region"
        aria-busy={loading}
        aria-label="拖拽 CSV 文件到此处导入"
        onDrop={handleDrop}
        onDragOver={(e) => {
          const [file] = Array.from(e.dataTransfer.files ?? []);
          if (isDroppedCsv(file)) {
            e.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        className={`empty-upload-card${isDragging ? ' empty-upload-card--dragging' : ''}`}
      >
        {loading ? (
          <>
            <span
              className="inline-loading-spinner empty-upload-spinner"
              aria-hidden="true"
            />
            <span className="empty-upload-title">正在解析文件，请稍候…</span>
          </>
        ) : (
          <>
            <span className="empty-upload-icon" aria-hidden="true">
              <InboxOutlined />
            </span>

            <div className="empty-upload-copy">
              <h1>{isDragging ? '释放 CSV 开始分析' : '导入 CSV，开始分析存档变动'}</h1>
              <p>
                把 Y3 存档变动日志拖到这里，或点击选择 CSV 文件。解析后可查看时间线、变动列表和前后快照对比。
              </p>
              <span>支持原始日志 / 清洗格式 · 最大 {MAX_CSV_FILE_SIZE_MB}MB · 自动识别新增 / 修改 / 删除</span>
            </div>

            <div className="empty-upload-actions">
              <button
                type="button"
                onClick={openFilePicker}
                className="upload-trigger upload-trigger--primary"
                aria-label="选择 CSV 文件"
              >
                选择 CSV 文件
              </button>
              <span className="empty-upload-secondary-note">也可以直接把 CSV 拖到这里</span>
            </div>

            <div className="empty-upload-chips" aria-label="支持的变动类型">
              <span className="empty-upload-chip empty-upload-chip--create">+ 新增</span>
              <span className="empty-upload-chip empty-upload-chip--update">~ 修改</span>
              <span className="empty-upload-chip empty-upload-chip--delete">- 删除</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
