import dayjs from 'dayjs';
import type { RecoveryReport } from './types';

/**
 * 生成 CSV 格式的恢复清单
 * @param report 恢复报告
 * @returns CSV 字符串
 */
export function generateCsv(report: RecoveryReport): string {
  const lines: string[] = [];

  // Header
  lines.push('玩家ID,存档键,出问题前的存档值,变动后值,变动时间,变动类型');

  // Data rows
  for (const player of report.players) {
    // 按 key 排序（Record 转为数组）
    const sortedChanges = Object.values(player.changes).sort((a, b) =>
      a.key.localeCompare(b.key)
    );

    for (const change of sortedChanges) {
      const row = [
        player.aid,
        change.key,
        escapeCsvValue(change.oldValue),
        escapeCsvValue(change.newValue),
        dayjs(change.timestamp).format('YYYY-MM-DD HH:mm:ss'),
        change.changeType,
      ].join(',');
      lines.push(row);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * 转义 CSV 值（处理逗号、引号、换行符）
 * 遵循 RFC 4180 标准
 */
function escapeCsvValue(value: string): string {
  // RFC 4180: 先转义引号为双引号，再判断是否需要加外层引号
  const escaped = value.replace(/"/g, '""');
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${escaped}"`;
  }
  return escaped;
}
