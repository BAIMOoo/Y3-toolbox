// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
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
