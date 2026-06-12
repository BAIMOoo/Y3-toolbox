// src/components/FileUpload.tsx
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

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  loading: boolean;
  fileName: string | null;
  variant?: 'dropzone' | 'toolbar';
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelected, loading, fileName, variant = 'dropzone' }) => {
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (variant === 'toolbar') return;
      const file = e.dataTransfer.files[0];
      if (!isDroppedCsv(file)) {
        setIsDragging(false);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      validateAndSelect(file);
    },
    [validateAndSelect, variant]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (variant === 'toolbar') return;
    const file = e.dataTransfer.files[0];
    if (!isDroppedCsv(file)) return;
    e.preventDefault();
    setIsDragging(true);
  }, [variant]);

  const handleDragLeave = useCallback(() => {
    if (variant === 'toolbar') return;
    setIsDragging(false);
  }, [variant]);

  const handleClick = useCallback(async () => {
    if (loading) return;
    if (window.electronAPI?.openFileDialog) {
      // Electron 环境：使用原生对话框
      const filePath = await window.electronAPI.openFileDialog();
      if (filePath) {
        const result = await window.electronAPI.readFile(filePath);
        if (result.success) {
          const file = new File([result.content], result.fileName, { type: 'text/csv' });
          validateAndSelect(file);
        } else {
          message.error(`文件读取失败：${result.error}`);
        }
      }
    } else {
      // Web 环境：回退到 <input type="file">
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) validateAndSelect(file);
      };
      input.click();
    }
  }, [loading, validateAndSelect]);

  if (variant === 'toolbar') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={loading ? '正在解析文件' : fileName ? `更换 CSV 文件，当前文件 ${fileName}` : '导入 CSV 文件'}
        aria-busy={loading}
        disabled={loading}
        className="upload-trigger upload-trigger--toolbar"
      >
        {loading ? <span className="inline-loading-spinner" aria-hidden="true" /> : <InboxOutlined />}
        {loading ? '解析中…' : fileName ? '更换 CSV' : '导入 CSV'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      aria-label="上传 CSV 文件，支持拖拽或点击选择"
      aria-busy={loading}
      disabled={loading}
      className={`upload-trigger upload-trigger--compact${isDragging ? ' upload-trigger--dragging' : ''}`}
    >
      {loading ? <span className="inline-loading-spinner" aria-hidden="true" /> : <InboxOutlined />}
      {loading ? '解析中…' : fileName ? `${fileName} (点击更换)` : '拖拽 CSV 到这里，或点击选择文件'}
    </button>
  );
};
