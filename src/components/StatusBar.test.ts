// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';

const currentChanges = { creates: 1, updates: 2, deletes: 3, noops: 0 };

afterEach(() => cleanup());

describe('StatusBar snapshot stats contract', () => {
  it('renders an explicit key count supplied by the parent', () => {
    render(React.createElement(StatusBar, {
      fileName: 'player.csv',
      timePointCount: 3,
      selectedIndex: 1,
      currentChanges,
      keyCount: 42,
      showSnapshotStats: true,
    }));

    expect(screen.getByText('存档键 42')).toBeTruthy();
    expect(screen.getByText('#2 / 3')).toBeTruthy();
  });

  it('omits snapshot key stats when recovery mode disables them', () => {
    render(React.createElement(StatusBar, {
      fileName: 'player.csv',
      timePointCount: 3,
      selectedIndex: 1,
      currentChanges,
      showSnapshotStats: false,
    }));

    expect(screen.queryByText(/存档键/)).toBeNull();
    expect(screen.getByText('#2 / 3')).toBeTruthy();
  });
});
