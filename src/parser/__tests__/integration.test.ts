// src/parser/__tests__/integration.test.ts
import { describe, it, expect } from 'vitest';
import { parseCsvText } from '../csvParser';
import { buildTimePoints, extractRootKeys } from '../pipeline';
import { SnapshotEngine } from '../../engine/snapshotEngine';
import type { SnapshotNode, SnapshotValue } from '../../types';

/** 辅助函数：安全深层索引快照值 */
function dig(obj: SnapshotValue, ...keys: string[]): SnapshotValue | undefined {
  let cur: SnapshotValue | undefined = obj;
  for (const k of keys) {
    if (cur === undefined || typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as SnapshotNode)[k];
  }
  return cur;
}

const SAMPLE_CSV = `日志时间,日志原文
2026-03-19 13:00:00.000,"Mar 19 13:00:00 up5 UP5_GameStatistic: [2026-03-19 13:00:00 +0800][MapArchiveUpload],{""game_server"":""game_5"",""archive_diff"":""|100=nil>>>42|89-100=nil>>>{}|89-100-宝石ID=nil>>>20014|89-100-宝石部位=nil>>>3""}"
2026-03-19 14:00:00.000,"Mar 19 14:00:00 up5 UP5_GameStatistic: [2026-03-19 14:00:00 +0800][MapArchiveUpload],{""game_server"":""game_3"",""archive_diff"":""|100=42>>>99|89-100-洗练次数=nil>>>5|74-20002-物品数量=Fix32(4502.00)>>>Fix32(4544.00)""}"
2026-03-19 15:00:00.000,"Mar 19 15:00:00 up5 UP5_GameStatistic: [2026-03-19 15:00:00 +0800][MapArchiveUpload],{""game_server"":""game_1"",""archive_diff"":""|89-100-宝石ID=20014>>>nil""}"`;

describe('Integration: CSV → TimePoints → Snapshots', () => {
  const rows = parseCsvText(SAMPLE_CSV);
  const timePoints = buildTimePoints(rows);
  const engine = new SnapshotEngine(timePoints);

  it('should parse 3 time points', () => {
    expect(timePoints).toHaveLength(3);
    expect(timePoints[0].changes).toHaveLength(4);
    expect(timePoints[1].changes).toHaveLength(3);
    expect(timePoints[2].changes).toHaveLength(1);
  });

  it('should build correct snapshot at T0', () => {
    const snap = engine.getSnapshotAt(0);
    expect(snap['100']).toBe('42');
    expect(dig(snap, '89', '100', '宝石ID')).toBe('20014');
    expect(dig(snap, '89', '100', '宝石部位')).toBe('3');
  });

  it('should build correct snapshot at T1 (accumulated)', () => {
    const snap = engine.getSnapshotAt(1);
    expect(snap['100']).toBe('99'); // updated
    expect(dig(snap, '89', '100', '宝石ID')).toBe('20014'); // unchanged
    expect(dig(snap, '89', '100', '洗练次数')).toBe('5'); // new
    expect(dig(snap, '74', '20002', '物品数量')).toBe('Fix32(4544.00)'); // new
  });

  it('should handle deletion at T2', () => {
    const snap = engine.getSnapshotAt(2);
    expect(dig(snap, '89', '100', '宝石ID')).toBeUndefined(); // deleted
    expect(dig(snap, '89', '100', '宝石部位')).toBe('3'); // still exists
  });

  it('should extract correct root keys', () => {
    const keys = extractRootKeys(timePoints);
    expect(keys).toContain('100');
    expect(keys).toContain('89');
    expect(keys).toContain('74');
  });
});
