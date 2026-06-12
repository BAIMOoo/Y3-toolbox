import { describe, it, expect } from 'vitest';
import { extractPlayerLogs } from '../extractPlayerLogs';
import type { RawLogRow } from '../../../src/types';

describe('extractPlayerLogs', () => {
  it('should extract AID from JSON and group by player', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: '{"aid":"30344223","archive_diff":"|100=1>>>2"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:06:00.000',
        rawText: '{"aid":"30344224","archive_diff":"|200=3>>>4"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:07:00.000',
        rawText: '{"aid":"30344223","archive_diff":"|300=5>>>6"}',
        isClean: false,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    expect(result.size).toBe(2);
    expect(result.get('30344223')).toHaveLength(2);
    expect(result.get('30344224')).toHaveLength(1);
  });

  it('should filter out logs before problem time', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 09:55:00.000',
        rawText: '{"aid":"30344223","archive_diff":"|100=1>>>2"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: '{"aid":"30344223","archive_diff":"|200=3>>>4"}',
        isClean: false,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    expect(result.get('30344223')).toHaveLength(1);
    expect(result.get('30344223')![0].timestamp).toBe('2026-03-20 10:05:00.000');
  });

  it('should handle logs without AID field', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: '{"archive_diff":"|100=1>>>2"}',
        isClean: false,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    expect(result.size).toBe(0);
  });

  it('should handle clean format logs', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: '|100=1>>>2',
        isClean: true,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    // Clean format 没有 AID，应该跳过
    expect(result.size).toBe(0);
  });

  it('should handle invalid timestamp gracefully', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: 'invalid-date',
        rawText: '{"aid":"30344223","archive_diff":"|100=1>>>2"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: '{"aid":"30344224","archive_diff":"|200=3>>>4"}',
        isClean: false,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    // Invalid timestamp 应该被跳过
    expect(result.size).toBe(1);
    expect(result.has('30344223')).toBe(false);
    expect(result.get('30344224')).toHaveLength(1);
  });

  it('should handle malformed JSON with regex fallback', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: 'Some prefix {"aid": "30344223", "archive_diff": "|100=1>>>2"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:06:00.000',
        rawText: 'Broken JSON {"aid":"30344224" missing bracket',
        isClean: false,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    // 第一条应该成功解析，第二条应该通过正则降级提取
    expect(result.size).toBe(2);
    expect(result.get('30344223')).toHaveLength(1);
    expect(result.get('30344224')).toHaveLength(1);
  });

  it('should reject empty or whitespace-only AID', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: '{"aid":"","archive_diff":"|100=1>>>2"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:06:00.000',
        rawText: '{"aid":"  ","archive_diff":"|200=3>>>4"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:07:00.000',
        rawText: '{"aid":"30344223","archive_diff":"|300=5>>>6"}',
        isClean: false,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    // 空字符串和纯空格的 AID 应该被拒绝
    expect(result.size).toBe(1);
    expect(result.get('30344223')).toHaveLength(1);
  });

  it('should reject non-string AID values', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 10:05:00.000',
        rawText: '{"aid":12345,"archive_diff":"|100=1>>>2"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:06:00.000',
        rawText: '{"aid":null,"archive_diff":"|200=3>>>4"}',
        isClean: false,
      },
      {
        timestamp: '2026-03-20 10:07:00.000',
        rawText: '{"aid":"30344223","archive_diff":"|300=5>>>6"}',
        isClean: false,
      },
    ];
    const problemTime = new Date('2026-03-20 10:00:00');
    const result = extractPlayerLogs(rows, problemTime);

    // 非字符串 AID 应该被拒绝
    expect(result.size).toBe(1);
    expect(result.get('30344223')).toHaveLength(1);
  });
});
