import dayjs from 'dayjs';
import type { RecoveryReport } from './types';

/**
 * 生成 Markdown 格式的审核报告
 * @param report 恢复报告
 * @returns Markdown 字符串
 */
export function generateMarkdown(report: RecoveryReport): string {
  const lines: string[] = [];

  // Title and summary
  lines.push('# 存档恢复清单');
  lines.push('');
  lines.push(`**问题发生时间**: ${dayjs(report.problemTime).format('YYYY-MM-DD HH:mm:ss')}`);
  lines.push(`**受影响玩家数**: ${report.totalPlayers}`);
  lines.push(`**总变动条目数**: ${report.totalChanges}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Player sections
  for (const player of report.players) {
    lines.push(`## 玩家 ${player.aid}`);
    lines.push('');

    const firstChangeTimeStr = player.firstChangeTime
      ? dayjs(player.firstChangeTime).format('YYYY-MM-DD HH:mm:ss')
      : 'N/A';

    lines.push(`**首次变动时间**: ${firstChangeTimeStr}`);
    lines.push(`**变动字段数**: ${Object.keys(player.changes).length}`);
    lines.push('');

    // Table
    lines.push('| 存档键 | 出问题前的存档值 | 变动后值 | 变动类型 |');
    lines.push('|--------|------------------|----------|----------|');

    // 按 key 排序（Record 转为数组）
    const sortedChanges = Object.values(player.changes).sort((a, b) =>
      a.key.localeCompare(b.key)
    );

    for (const change of sortedChanges) {
      lines.push(
        `| ${escapeMarkdown(change.key)} | ${escapeMarkdown(change.oldValue)} | ${escapeMarkdown(change.newValue)} | ${change.changeType} |`
      );
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 转义 Markdown 特殊字符
 */
function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')  // 反斜杠必须先转义
    .replace(/\|/g, '\\|')   // 管道符转义
    .replace(/\n/g, '\\n')   // 换行符转为字面量
    .replace(/\r/g, '\\r');  // 回车符转为字面量
}
