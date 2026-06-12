import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '../generateMarkdown';
import type { RecoveryReport, PlayerRecoveryData } from '../types';

describe('generateMarkdown', () => {
  it('should generate markdown with correct structure', () => {
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

    const md = generateMarkdown(report);

    expect(md).toContain('# 存档恢复清单');
    expect(md).toContain('**问题发生时间**: 2026-03-20 10:00:00');
    expect(md).toContain('**受影响玩家数**: 1');
    expect(md).toContain('**总变动条目数**: 1');
    expect(md).toContain('## 玩家 30344223');
    expect(md).toContain('**首次变动时间**: 2026-03-20 10:05:00');
    expect(md).toContain('**变动字段数**: 1');
    expect(md).toContain('| 存档键 | 出问题前的存档值 | 变动后值 | 变动类型 |');
    expect(md).toContain('| 100 | 1 | 2 | update |');
  });

  it('should handle multiple players', () => {
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
      {
        aid: '30344224',
        firstChangeTime: new Date('2026-03-20 10:06:00'),
        changes: {
          '200': {
            key: '200',
            oldValue: '3',
            newValue: '4',
            timestamp: new Date('2026-03-20 10:06:00'),
            changeType: 'update',
          },
        },
      },
    ];

    const report: RecoveryReport = {
      problemTime: new Date('2026-03-20 10:00:00'),
      totalPlayers: 2,
      totalChanges: 2,
      players,
    };

    const md = generateMarkdown(report);

    expect(md).toContain('## 玩家 30344223');
    expect(md).toContain('## 玩家 30344224');
  });

  it('should handle empty report', () => {
    const report: RecoveryReport = {
      problemTime: new Date('2026-03-20 10:00:00'),
      totalPlayers: 0,
      totalChanges: 0,
      players: [],
    };

    const md = generateMarkdown(report);

    expect(md).toContain('# 存档恢复清单');
    expect(md).toContain('**受影响玩家数**: 0');
    expect(md).not.toContain('## 玩家');
  });

  it('should escape special characters in markdown table', () => {
    const players: PlayerRecoveryData[] = [
      {
        aid: '30344223',
        firstChangeTime: new Date('2026-03-20 10:05:00'),
        changes: {
          'key|with|pipes': {
            key: 'key|with|pipes',
            oldValue: 'value|with|pipe',
            newValue: 'new\\value\nwith\rspecial',
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

    const md = generateMarkdown(report);

    // 管道符应该被转义
    expect(md).toContain('key\\|with\\|pipes');
    expect(md).toContain('value\\|with\\|pipe');
    // 反斜杠应该被转义
    expect(md).toContain('new\\\\value');
    // 换行符应该被转义为字面量
    expect(md).toContain('\\n');
    expect(md).toContain('\\r');
    // 确保表格结构没有被破坏（不应该有实际的换行符）
    const lines = md.split('\n');
    const tableLine = lines.find(line => line.includes('key\\|with\\|pipes'));
    expect(tableLine).toBeDefined();
    expect(tableLine).toMatch(/^\|.*\|.*\|.*\|.*\|$/);
  });

  it('should handle null firstChangeTime', () => {
    const players: PlayerRecoveryData[] = [
      {
        aid: '30344223',
        firstChangeTime: null,
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

    const md = generateMarkdown(report);

    expect(md).toContain('**首次变动时间**: N/A');
  });
});
