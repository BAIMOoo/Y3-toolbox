// scripts/recovery/types.ts
import type { ChangeType } from '../../src/types';

/** 单个字段的第一次变动记录 */
export interface FirstChange {
  /** 完整键路径，如 "74-20007-物品数量" */
  key: string;
  /** 出问题前的存档值 */
  oldValue: string;
  /** 变动后的值 */
  newValue: string;
  /** 第一次变动的时间（ISO 8601 格式） */
  timestamp: Date;
  /** 变动类型 */
  changeType: ChangeType;
}

/** 单个玩家的恢复数据 */
export interface PlayerRecoveryData {
  /** 玩家 ID (AID) */
  aid: string;
  /** 该玩家首次变动时间（玩家无变动时为 null） */
  firstChangeTime: Date | null;
  /** key -> FirstChange 映射 */
  changes: Record<string, FirstChange>;
}

/** 全局恢复报告 */
export interface RecoveryReport {
  /** 问题发生时间 */
  problemTime: Date;
  /** 受影响玩家数 */
  totalPlayers: number;
  /** 总变动条目数 */
  totalChanges: number;
  /** 按 AID 排序的玩家数据 */
  players: PlayerRecoveryData[];
}
