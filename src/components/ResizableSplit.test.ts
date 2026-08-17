// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { clampSplitRatio, nextKeyboardSplitRatio } from './resizableSplitMath';
import { ResizableSplit } from './ResizableSplit';

afterEach(() => {
  cleanup();
});

describe('ResizableSplit keyboard ratio helpers', () => {
  it('clamps pointer ratios to the configured range', () => {
    expect(clampSplitRatio(0.1, 0.2, 0.8)).toBe(0.2);
    expect(clampSplitRatio(0.9, 0.2, 0.8)).toBe(0.8);
    expect(clampSplitRatio(0.45, 0.2, 0.8)).toBe(0.45);
  });

  it('maps keyboard resizing keys to predictable ratios', () => {
    expect(nextKeyboardSplitRatio(0.4, 'ArrowLeft', 0.2, 0.8)).toBeCloseTo(0.35);
    expect(nextKeyboardSplitRatio(0.4, 'ArrowRight', 0.2, 0.8)).toBeCloseTo(0.45);
    expect(nextKeyboardSplitRatio(0.4, 'Home', 0.2, 0.8)).toBe(0.2);
    expect(nextKeyboardSplitRatio(0.4, 'End', 0.2, 0.8)).toBe(0.8);
  });

  it('ignores unrelated keys and respects bounds', () => {
    expect(nextKeyboardSplitRatio(0.2, 'ArrowLeft', 0.2, 0.8)).toBe(0.2);
    expect(nextKeyboardSplitRatio(0.8, 'ArrowRight', 0.2, 0.8)).toBe(0.8);
    expect(nextKeyboardSplitRatio(0.4, 'Escape', 0.2, 0.8)).toBeNull();
  });

  it('updates separator ARIA value state from keyboard input', () => {
    render(React.createElement(ResizableSplit, {
      left: React.createElement('div', null, 'left'),
      right: React.createElement('div', null, 'right'),
      defaultRatio: 0.4,
      minRatio: 0.2,
      maxRatio: 0.8,
    }));

    const separator = screen.getByRole('separator', { name: /拖拽调整面板大小/ });
    expect(separator.getAttribute('aria-valuenow')).toBe('40');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('45');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('20');
  });

  it('supports a specific separator label and pane overflow strategy', () => {
    render(React.createElement(ResizableSplit, {
      left: React.createElement('div', null, 'left'),
      right: React.createElement('div', null, 'right'),
      separatorLabel: '调整检查面板宽度',
      paneOverflow: 'hidden',
      className: 'test-split',
    }));

    expect(screen.getByRole('separator', { name: '调整检查面板宽度' })).toBeTruthy();
    expect(document.querySelector('.resizable-split.test-split')).toBeTruthy();
    expect(document.querySelector('.resizable-split-pane--left')).toHaveStyle({ overflow: 'hidden' });
  });

  it('updates the split ratio while dragging the separator', () => {
    render(React.createElement(ResizableSplit, {
      left: React.createElement('div', null, 'left'),
      right: React.createElement('div', null, 'right'),
      defaultRatio: 0.4,
    }));

    const split = document.querySelector('.resizable-split');
    if (!(split instanceof HTMLDivElement)) throw new Error('Resizable split was not rendered');
    vi.spyOn(split, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      top: 0,
      bottom: 600,
      width: 1000,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const separator = screen.getByRole('separator', { name: /拖拽调整面板大小/ });

    fireEvent.mouseDown(separator);
    fireEvent.mouseMove(document, { clientX: 600 });
    fireEvent.mouseUp(document);

    expect(separator).toHaveAttribute('aria-valuenow', '60');
  });

  it('restores global drag styles when unmounted mid-drag', () => {
    const { unmount } = render(React.createElement(ResizableSplit, {
      left: React.createElement('div', null, 'left'),
      right: React.createElement('div', null, 'right'),
    }));

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const separator = screen.getByRole('separator', { name: /拖拽调整面板大小/ });

    fireEvent.mouseDown(separator);
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');

    unmount();
    expect(document.body.style.cursor).toBe(previousCursor);
    expect(document.body.style.userSelect).toBe(previousUserSelect);
  });
});
