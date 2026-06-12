import { describe, it, expect } from 'vitest';
import { buildTimePoints } from '../pipeline';
import type { RawLogRow } from '../../types';

describe('buildTimePoints', () => {
  it('should handle clean format rows (isClean=true)', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2026-03-19 14:00:00.000', rawText: '|100=1>>>2|200=nil>>>5', isClean: true },
      { timestamp: '2026-03-19 13:00:00.000', rawText: '|50=10>>>20', isClean: true },
    ];
    const timePoints = buildTimePoints(rows);
    expect(timePoints).toHaveLength(2);
    expect(timePoints[0].timestamp.getTime()).toBeLessThan(timePoints[1].timestamp.getTime());
    expect(timePoints[0].index).toBe(0);
    expect(timePoints[1].index).toBe(1);
    expect(timePoints[0].changes).toHaveLength(1);
    expect(timePoints[1].changes).toHaveLength(2);
  });

  it('should handle raw format rows (isClean undefined)', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2026-03-19 14:00:00.000', rawText: 'prefix {"archive_diff":"|100=1>>>2|200=nil>>>5"}' },
      { timestamp: '2026-03-19 13:00:00.000', rawText: 'prefix {"archive_diff":"|50=10>>>20"}' },
    ];
    const timePoints = buildTimePoints(rows);
    expect(timePoints).toHaveLength(2);
    expect(timePoints[0].changes).toHaveLength(1);
    expect(timePoints[1].changes).toHaveLength(2);
  });

  it('should merge rows with same timestamp', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2026-03-19 13:00:00.000', rawText: '|100=1>>>2', isClean: true },
      { timestamp: '2026-03-19 13:00:00.000', rawText: '|200=3>>>4', isClean: true },
    ];
    const timePoints = buildTimePoints(rows);
    expect(timePoints).toHaveLength(1);
    expect(timePoints[0].changes).toHaveLength(2);
  });

  it('should skip rows without archive_diff', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2026-03-19 13:00:00.000', rawText: 'no diff here' },
      { timestamp: '2026-03-19 14:00:00.000', rawText: '|100=1>>>2', isClean: true },
    ];
    const timePoints = buildTimePoints(rows);
    expect(timePoints).toHaveLength(1);
  });
});
