import { describe, it, expect } from 'vitest';
import { findFirstChanges } from '../findFirstChanges';
import type { RawLogRow } from '../../../src/types';

describe('findFirstChanges', () => {
  it('should find first change for each key per player', () => {
    const playerLogsMap = new Map<string, RawLogRow[]>([
      [
        '30344223',
        [
          {
            timestamp: '2026-03-20 10:05:00.000',
            rawText: '|100=1>>>2|200=3>>>4',
            isClean: true,
          },
          {
            timestamp: '2026-03-20 10:06:00.000',
            rawText: '|100=2>>>3|300=5>>>6',
            isClean: true,
          },
        ],
      ],
    ]);

    const result = findFirstChanges(playerLogsMap);

    expect(result).toHaveLength(1);
    expect(result[0].aid).toBe('30344223');
    expect(Object.keys(result[0].changes)).toHaveLength(3);

    const change100 = result[0].changes['100'];
    expect(change100?.oldValue).toBe('1');
    expect(change100?.newValue).toBe('2');

    const change200 = result[0].changes['200'];
    expect(change200?.oldValue).toBe('3');

    const change300 = result[0].changes['300'];
    expect(change300?.oldValue).toBe('5');
  });

  it('should handle multiple players', () => {
    const playerLogsMap = new Map<string, RawLogRow[]>([
      [
        '30344223',
        [
          {
            timestamp: '2026-03-20 10:05:00.000',
            rawText: '|100=1>>>2',
            isClean: true,
          },
        ],
      ],
      [
        '30344224',
        [
          {
            timestamp: '2026-03-20 10:06:00.000',
            rawText: '|200=3>>>4',
            isClean: true,
          },
        ],
      ],
    ]);

    const result = findFirstChanges(playerLogsMap);

    expect(result).toHaveLength(2);
    expect(result[0].aid).toBe('30344223');
    expect(result[1].aid).toBe('30344224');
  });

  it('should set firstChangeTime correctly', () => {
    const playerLogsMap = new Map<string, RawLogRow[]>([
      [
        '30344223',
        [
          {
            timestamp: '2026-03-20 10:05:00.000',
            rawText: '|100=1>>>2',
            isClean: true,
          },
        ],
      ],
    ]);

    const result = findFirstChanges(playerLogsMap);

    expect(result[0].firstChangeTime).toEqual(new Date('2026-03-20 10:05:00.000'));
  });

  it('should handle empty player logs', () => {
    const playerLogsMap = new Map<string, RawLogRow[]>();
    const result = findFirstChanges(playerLogsMap);
    expect(result).toHaveLength(0);
  });

  it('should only record first change when same key changes multiple times', () => {
    const playerLogsMap = new Map<string, RawLogRow[]>([
      [
        '30344223',
        [
          {
            timestamp: '2026-03-20 10:05:00.000',
            rawText: '|100=1>>>2',
            isClean: true,
          },
          {
            timestamp: '2026-03-20 10:06:00.000',
            rawText: '|100=2>>>3',
            isClean: true,
          },
          {
            timestamp: '2026-03-20 10:07:00.000',
            rawText: '|100=3>>>4',
            isClean: true,
          },
        ],
      ],
    ]);

    const result = findFirstChanges(playerLogsMap);

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0].changes)).toHaveLength(1);

    const change100 = result[0].changes['100'];
    expect(change100?.oldValue).toBe('1');
    expect(change100?.newValue).toBe('2');
    expect(change100?.timestamp).toEqual(new Date('2026-03-20 10:05:00.000'));
  });

  it('should handle player with logs but no valid changes', () => {
    const playerLogsMap = new Map<string, RawLogRow[]>([
      [
        '30344223',
        [
          {
            timestamp: '2026-03-20 10:05:00.000',
            rawText: '',
            isClean: true,
          },
        ],
      ],
    ]);

    const result = findFirstChanges(playerLogsMap);

    expect(result).toHaveLength(1);
    expect(result[0].aid).toBe('30344223');
    expect(Object.keys(result[0].changes)).toHaveLength(0);
    expect(result[0].firstChangeTime).toBeNull();
  });
});
