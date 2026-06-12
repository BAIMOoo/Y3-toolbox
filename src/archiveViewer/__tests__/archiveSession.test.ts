import { describe, expect, it } from 'vitest';
import { clampArchiveTabIndex, nextIndexAfterClose, parseArchiveSession, serializeArchiveSession } from '../archiveSession';

describe('archiveSession', () => {
  it('serializes only ui tab paths and clamps current index', () => {
    expect(serializeArchiveSession(['/a', '', '/b'], 9)).toBe(JSON.stringify({ tabs: ['/a', '/b'], current: 1 }));
  });

  it('parses invalid or stale localStorage payloads safely', () => {
    expect(parseArchiveSession(null)).toEqual({ tabs: [], current: 0 });
    expect(parseArchiveSession('bad')).toEqual({ tabs: [], current: 0 });
    expect(parseArchiveSession(JSON.stringify({ tabs: ['/a', 1, '/b'], current: -1 }))).toEqual({ tabs: ['/a', '/b'], current: 0 });
  });

  it('computes next selected tab after close', () => {
    expect(nextIndexAfterClose(3, 2, 0)).toBe(1);
    expect(nextIndexAfterClose(3, 1, 1)).toBe(1);
    expect(nextIndexAfterClose(1, 0, 0)).toBe(0);
    expect(clampArchiveTabIndex(2, 4)).toBe(1);
  });
});
