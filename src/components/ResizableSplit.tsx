// src/components/ResizableSplit.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { clampSplitRatio, nextKeyboardSplitRatio } from './resizableSplitMath';

interface ResizableSplitProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
}


export const ResizableSplit: React.FC<ResizableSplitProps> = ({
  left,
  right,
  defaultRatio = 0.4,
  minRatio = 0.2,
  maxRatio = 0.8,
}) => {
  const [ratio, setRatio] = useState(defaultRatio);
  const [handleActive, setHandleActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const cleanupDragSideEffects = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    isDragging.current = false;
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      cleanupDragSideEffects();
      isDragging.current = true;
      setHandleActive(true);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const newRatio = (ev.clientX - rect.left) / rect.width;
        setRatio(clampSplitRatio(newRatio, minRatio, maxRatio));
      };

      const cleanupMouseDrag = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
      };

      const onMouseUp = () => {
        cleanupDragSideEffects();
        setHandleActive(false);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      dragCleanupRef.current = cleanupMouseDrag;
    },
    [cleanupDragSideEffects, minRatio, maxRatio]
  );

  // 触摸设备支持
  const handleTouchStart = useCallback(
    () => {
      cleanupDragSideEffects();
      isDragging.current = true;
      setHandleActive(true);

      const onTouchMove = (ev: TouchEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        ev.preventDefault();
        const rect = containerRef.current.getBoundingClientRect();
        const touch = ev.touches[0];
        const newRatio = (touch.clientX - rect.left) / rect.width;
        setRatio(clampSplitRatio(newRatio, minRatio, maxRatio));
      };

      const cleanupTouchDrag = () => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
      };

      const onTouchEnd = () => {
        cleanupDragSideEffects();
        setHandleActive(false);
      };

      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      dragCleanupRef.current = cleanupTouchDrag;
    },
    [cleanupDragSideEffects, minRatio, maxRatio]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const nextRatio = nextKeyboardSplitRatio(ratio, e.key, minRatio, maxRatio);
    if (nextRatio === null) return;
    e.preventDefault();
    setRatio(nextRatio);
  }, [ratio, minRatio, maxRatio]);

  useEffect(() => cleanupDragSideEffects, [cleanupDragSideEffects]);

  return (
    <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div style={{ width: `${ratio * 100}%`, overflow: 'auto' }}>{left}</div>
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整面板大小"
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={`左侧面板 ${Math.round(ratio * 100)}%`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="resizable-split-separator"
        onMouseEnter={() => setHandleActive(true)}
        onMouseLeave={() => {
          if (!isDragging.current) setHandleActive(false);
        }}
        onFocus={() => setHandleActive(true)}
        onBlur={() => {
          if (!isDragging.current) setHandleActive(false);
        }}
        style={{
          width: 16,              // 实际触摸/键盘焦点区 16px，视觉线仍保持 4px
          cursor: 'col-resize',
          flexShrink: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        }}
      >
        {/* 视觉分割线：4px，居中 */}
        <div
          className="rs-line"
          style={{
            position: 'absolute',
            top: 0, bottom: 0,
            width: 4,
            background: handleActive ? 'var(--accent-blue)' : 'var(--border)',
            transition: 'background 0.2s var(--ease-out)',
          }}
        />
        {/* hover 时显示的三点指示器 */}
        <div
          className="rs-dots"
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            opacity: handleActive ? 1 : 0,
            transition: 'opacity 0.15s',
            zIndex: 1,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              width: 3, height: 3, borderRadius: '50%',
              background: 'var(--accent-blue)',
            }} />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>{right}</div>
    </div>
  );
};
