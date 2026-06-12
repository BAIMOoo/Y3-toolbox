import { buildTimePoints } from '../../src/parser/pipeline';
import type { RawLogRow } from '../../src/types';
import type { PlayerRecoveryData, FirstChange } from './types';

/**
 * 找出每个玩家每个字段的第一次变动
 * @param playerLogsMap 按玩家分组的日志
 * @returns 每个玩家的恢复数据
 */
export function findFirstChanges(
  playerLogsMap: Map<string, RawLogRow[]>
): PlayerRecoveryData[] {
  const results: PlayerRecoveryData[] = [];

  for (const [aid, logs] of playerLogsMap.entries()) {
    const playerData = processPlayerLogs(aid, logs);
    results.push(playerData);
  }

  // 按 AID 排序
  results.sort((a, b) => a.aid.localeCompare(b.aid));

  return results;
}

/**
 * 处理单个玩家的日志，找出每个字段的第一次变动
 */
function processPlayerLogs(aid: string, logs: RawLogRow[]): PlayerRecoveryData {
  const timePoints = buildTimePoints(logs);
  const changes: Record<string, FirstChange> = {};  // 使用 Record 而非 Map（便于 JSON 序列化）
  let firstChangeTime: Date | null = null;

  // 按时间顺序遍历（buildTimePoints 已按时间升序排序）
  for (const tp of timePoints) {
    for (const change of tp.changes) {
      // 如果该 key 还没记录过，则记录第一次变动
      if (!changes[change.key]) {
        changes[change.key] = {
          key: change.key,
          oldValue: change.oldValue,
          newValue: change.newValue,
          timestamp: tp.timestamp,
          changeType: change.changeType,
        };

        // 记录首次变动时间（只在第一次遇到变动时设置）
        if (!firstChangeTime) {
          firstChangeTime = tp.timestamp;
        }
      }
    }
  }

  return {
    aid,
    firstChangeTime,
    changes,
  };
}
