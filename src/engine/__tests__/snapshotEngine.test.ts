import { describe, it, expect } from 'vitest';
import { SnapshotEngine } from '../snapshotEngine';
import type { TimePoint, SnapshotNode, SnapshotValue } from '../../types';

/** 辅助函数：安全深层索引快照值 */
function dig(obj: SnapshotValue, ...keys: string[]): SnapshotValue | undefined {
  let cur: SnapshotValue | undefined = obj;
  for (const k of keys) {
    if (cur === undefined || typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as SnapshotNode)[k];
  }
  return cur;
}

function makeTimePoint(index: number, changes: Array<{ key: string; old: string; new: string }>): TimePoint {
  return {
    index,
    timestamp: new Date(`2026-03-19T${String(index).padStart(2, '0')}:00:00`),
    changes: changes.map((c) => ({
      key: c.key,
      keyParts: c.key.split('-'),
      rootKey: c.key.split('-')[0],
      oldValue: c.old,
      newValue: c.new,
      changeType: c.old === 'nil' ? 'create' : c.new === 'nil' ? 'delete' : 'update',
    })),
  };
}

describe('SnapshotEngine', () => {
  it('should build snapshots from empty state', () => {
    const tp = [makeTimePoint(0, [{ key: '100', old: 'nil', new: '42' }])];
    const engine = new SnapshotEngine(tp);
    expect(engine.getSnapshotAt(0)).toEqual({ '100': '42' });
  });
  it('should accumulate changes across time points', () => {
    const tps = [
      makeTimePoint(0, [{ key: '100', old: 'nil', new: '42' }]),
      makeTimePoint(1, [{ key: '200', old: 'nil', new: '99' }]),
    ];
    const engine = new SnapshotEngine(tps);
    expect(engine.getSnapshotAt(0)).toEqual({ '100': '42' });
    expect(engine.getSnapshotAt(1)).toEqual({ '100': '42', '200': '99' });
  });
  it('should handle nested keys', () => {
    const tps = [makeTimePoint(0, [
      { key: '89-12572', old: 'nil', new: '{}' },
      { key: '89-12572-宝石ID', old: 'nil', new: '20014' },
    ])];
    const engine = new SnapshotEngine(tps);
    expect(dig(engine.getSnapshotAt(0), '89', '12572', '宝石ID')).toBe('20014');
  });
  it('should handle deletion (value >>> nil)', () => {
    const tps = [
      makeTimePoint(0, [{ key: '100', old: 'nil', new: '42' }]),
      makeTimePoint(1, [{ key: '100', old: '42', new: 'nil' }]),
    ];
    const engine = new SnapshotEngine(tps);
    expect(engine.getSnapshotAt(0)).toEqual({ '100': '42' });
    expect(engine.getSnapshotAt(1)).toEqual({});
  });
  it('should handle updates', () => {
    const tps = [
      makeTimePoint(0, [{ key: '100', old: 'nil', new: '42' }]),
      makeTimePoint(1, [{ key: '100', old: '42', new: '99' }]),
    ];
    const engine = new SnapshotEngine(tps);
    expect(engine.getSnapshotAt(1)).toEqual({ '100': '99' });
  });
  it('should return empty snapshot for index -1', () => {
    const tps = [makeTimePoint(0, [{ key: '100', old: 'nil', new: '42' }])];
    const engine = new SnapshotEngine(tps);
    expect(engine.getSnapshotAt(-1)).toEqual({});
  });
  it('should handle {} as empty object in nested creation', () => {
    const tps = [makeTimePoint(0, [{ key: '89-100', old: 'nil', new: '{}' }])];
    const engine = new SnapshotEngine(tps);
    expect(engine.getSnapshotAt(0)).toEqual({ '89': { '100': {} } });
  });
});
