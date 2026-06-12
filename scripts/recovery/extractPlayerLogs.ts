import type { RawLogRow } from '../../src/types';

/**
 * 从 CSV 日志中提取 AID 并按玩家分组
 * @param rows 原始日志行
 * @param problemTime 问题发生时间
 * @returns Map<AID, 该玩家问题时间后的日志>
 */
export function extractPlayerLogs(
  rows: RawLogRow[],
  problemTime: Date
): Map<string, RawLogRow[]> {
  const playerLogsMap = new Map<string, RawLogRow[]>();

  for (const row of rows) {
    // 时间过滤（包含 Invalid Date 检查）
    const rowTime = new Date(row.timestamp);
    if (isNaN(rowTime.getTime()) || rowTime < problemTime) continue;

    // 提取 AID
    const aid = extractAid(row);
    if (!aid) continue;

    // 按 AID 分组（简化版本）
    if (!playerLogsMap.has(aid)) {
      playerLogsMap.set(aid, []);
    }
    playerLogsMap.get(aid)!.push(row);
  }

  return playerLogsMap;
}

/**
 * 从日志文本中提取 AID
 * @param row 原始日志行
 * @returns AID 或 null
 */
function extractAid(row: RawLogRow): string | null {
  // 优先从 originalText 提取（原始日志格式）
  const textToSearch = row.originalText || row.rawText;

  try {
    // 尝试解析 JSON
    const jsonStart = textToSearch.indexOf('{');
    if (jsonStart === -1) return null;
    const jsonStr = textToSearch.substring(jsonStart);
    const data = JSON.parse(jsonStr);
    const aid = data.aid;
    // 验证 AID 是字符串且非空
    return (aid && typeof aid === 'string' && aid.trim()) ? aid : null;
  } catch {
    // 降级策略：使用正则表达式更准确地匹配
    const match = textToSearch.match(/"aid"\s*:\s*"([^"]+)"/);
    return match?.[1] || null;
  }
}
