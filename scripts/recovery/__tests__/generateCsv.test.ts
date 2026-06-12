import { describe, it, expect } from 'vitest';
import { generateCsv } from '../generateCsv';
import type { RecoveryReport, PlayerRecoveryData } from '../types';

describe('generateCsv', () => {
  it('should generate CSV with correct headers and data', () => {
    const players: PlayerRecoveryData[] = [
      {
        aid: '30344223',
        firstChangeTime: new Date('2026-03-20 10:05:00'),
        changes: {
          '100': {
            key: '100',
            oldValue: '1',
            newValue: '2',
            timestamp: new Date('2026-03-20 10:05:00'),
            changeType: 'update',
          },
        },
      },
    ];

    const report: RecoveryReport = {
      problemTime: new Date('2026-03-20 10:00:00'),
      totalPlayers: 1,
      totalChanges: 1,
      players,
    };

    const csv = generateCsv(report);

    expect(csv).toContain('玩家ID,存档键,出问题前的存档值,变动后值,变动时间,变动类型');
    expect(csv).toContain('30344223,100,1,2,2026-03-20 10:05:00,update');
  });

  it('should handle multiple players and changes', () => {
    const players: PlayerRecoveryData[] = [
      {
        aid: '30344223',
        firstChangeTime: new Date('2026-03-20 10:05:00'),
        changes: {
          '100': {
            key: '100',
            oldValue: '1',
            newValue: '2',
            timestamp: new Date('2026-03-20 10:05:00'),
            changeType: 'update',
          },
          '200': {
            key: '200',
            oldValue: 'nil',
            newValue: '5',
            timestamp: new Date('2026-03-20 10:05:00'),
            changeType: 'create',
          },
        },
      },
      {
        aid: '30344224',
        firstChangeTime: new Date('2026-03-20 10:06:00'),
        changes: {
          '300': {
            key: '300',
            oldValue: '10',
            newValue: 'nil',
            timestamp: new Date('2026-03-20 10:06:00'),
            changeType: 'delete',
          },
        },
      },
    ];

    const report: RecoveryReport = {
      problemTime: new Date('2026-03-20 10:00:00'),
      totalPlayers: 2,
      totalChanges: 3,
      players,
    };

    const csv = generateCsv(report);

    const lines = csv.split('\n');
    expect(lines).toHaveLength(5); // header + 3 data rows + trailing newline
    expect(lines[1]).toContain('30344223,100');
    expect(lines[2]).toContain('30344223,200');
    expect(lines[3]).toContain('30344224,300');
  });

  it('should handle empty report', () => {
    const report: RecoveryReport = {
      problemTime: new Date('2026-03-20 10:00:00'),
      totalPlayers: 0,
      totalChanges: 0,
      players: [],
    };

    const csv = generateCsv(report);

    expect(csv).toBe('玩家ID,存档键,出问题前的存档值,变动后值,变动时间,变动类型\n');
  });

  it('should escape CSV special characters', () => {
    const players: PlayerRecoveryData[] = [
      {
        aid: '123',
        firstChangeTime: new Date('2026-03-20 10:00:00'),
        changes: {
          'key1': {
            key: 'key1',
            oldValue: 'value,with,commas',
            newValue: 'say "hello"',
            timestamp: new Date('2026-03-20 10:00:00'),
            changeType: 'update',
          },
          'key2': {
            key: 'key2',
            oldValue: 'line1\nline2',
            newValue: 'normal',
            timestamp: new Date('2026-03-20 10:00:00'),
            changeType: 'update',
          },
          'key3': {
            key: 'key3',
            oldValue: 'just"quote',
            newValue: 'with\rcarriage',
            timestamp: new Date('2026-03-20 10:00:00'),
            changeType: 'update',
          },
        },
      },
    ];

    const report: RecoveryReport = {
      problemTime: new Date('2026-03-20 10:00:00'),
      totalPlayers: 1,
      totalChanges: 3,
      players,
    };

    const csv = generateCsv(report);

    // 验证逗号被引号包裹
    expect(csv).toContain('"value,with,commas"');
    // 验证引号被转义为双引号并加外层引号
    expect(csv).toContain('"say ""hello"""');
    // 验证换行符被引号包裹
    expect(csv).toContain('"line1\nline2"');
    // 验证单独的引号也被转义并加外层引号
    expect(csv).toContain('"just""quote"');
    // 验证回车符被引号包裹
    expect(csv).toContain('"with\rcarriage"');
    // 验证普通值不加引号
    expect(csv).toContain(',normal,');
  });
});
