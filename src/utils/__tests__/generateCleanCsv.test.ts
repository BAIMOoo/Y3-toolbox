import { describe, it, expect } from 'vitest';
import { generateCleanCsv } from '../generateCleanCsv';
import type { RawLogRow } from '../../types';

describe('generateCleanCsv', () => {
  it('generates CSV with 日志时间 and archive_diff columns, quotes all fields', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2025-01-15 10:30:00', rawText: '|89-1=nil>>>1', isClean: true },
      { timestamp: '2025-01-15 10:31:00', rawText: '|89-2=1>>>2', isClean: true },
    ];

    const csv = generateCleanCsv(rows);

    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"日志时间","archive_diff"');
    expect(lines[1]).toBe('"2025-01-15 10:30:00","|89-1=nil>>>1"');
    expect(lines[2]).toBe('"2025-01-15 10:31:00","|89-2=1>>>2"');
  });

  it('ends with a trailing newline', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2025-01-15 10:30:00', rawText: '|k=a>>>b', isClean: true },
    ];

    const csv = generateCleanCsv(rows);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('handles fields containing commas and double quotes', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2025-01-15 10:30:00', rawText: '|k="hello, world">>>bye', isClean: true },
    ];

    const csv = generateCleanCsv(rows);
    const lines = csv.split('\r\n');
    // PapaParse escapes inner double quotes by doubling them
    expect(lines[1]).toContain('"2025-01-15 10:30:00"');
    // Verify the archive_diff field with special characters is properly escaped
    expect(lines[1]).toContain('|k=""hello, world"">>>bye');
  });

  it('returns only a trailing newline for empty rows', () => {
    const csv = generateCleanCsv([]);
    expect(csv).toBe('\r\n');
  });
});
