// src/types/index.ts

/** 变动类型 */
export type ChangeType = 'create' | 'update' | 'delete' | 'noop';

/** 单条存档变动 */
export interface ArchiveChange {
  /** 完整键路径, e.g. "89-12572-宝石ID" */
  key: string;
  /** 键路径分段, e.g. ["89", "12572", "宝石ID"] */
  keyParts: string[];
  /** 根键, e.g. "89" */
  rootKey: string;
  /** 旧值字符串, e.g. "nil", "Fix32(4502.00)" */
  oldValue: string;
  /** 新值字符串 */
  newValue: string;
  /** 变动类型 */
  changeType: ChangeType;
}

/** 时间节点 — 一条或多条同时间戳的日志行合并后的变动集合 */
export interface TimePoint {
  /** 在排序后的时间点列表中的索引 (0-based) */
  index: number;
  /** 时间戳 */
  timestamp: Date;
  /** 该时刻的所有变动 */
  changes: ArchiveChange[];
}

/** 快照中的值类型 — 叶子为 string，嵌套为 SnapshotNode */
export type SnapshotValue = string | SnapshotNode;

/** 快照嵌套节点 */
export interface SnapshotNode {
  [key: string]: SnapshotValue;
}

/** 存档快照 — 某时刻的完整存档状态 (嵌套对象) */
export type Snapshot = SnapshotNode;

/** CSV 原始行 */
export interface RawLogRow {
  timestamp: string;
  /** For clean format: the archive_diff string directly. For raw format: also cleaned to diff string by csvParser. */
  rawText: string;
  /** Whether rawText is already a clean archive_diff string (vs. full syslog line) */
  isClean?: boolean;
  /**
   * Original log text (for extracting metadata like AID).
   * Only present for raw format where the full syslog line contains JSON with metadata.
   * Used by recovery tools to extract player IDs and other context.
   */
  originalText?: string;
}

/** 筛选条件 */
export interface FilterState {
  /** 时间范围 [start, end] */
  timeRange: [Date, Date] | null;
  /** 选中的根键列表, 空 = 全部 */
  rootKeys: string[];
  /** 选中的变动类型, 空 = 全部 */
  changeTypes: ChangeType[];
  /** 值搜索关键词 */
  searchKeyword: string;
}

/** 快照对比显示模式 */
export type DisplayMode = 'all' | 'diff' | 'context';

/** 应用全局状态 */
export interface AppState {
  /** 所有时间节点 (按时间排序) */
  timePoints: TimePoint[];
  /** 当前选中的时间节点索引 */
  selectedIndex: number;
  /** 筛选条件 */
  filter: FilterState;
  /** 所有出现过的根键 (用于筛选器选项) */
  availableRootKeys: string[];
  /** 已加载的文件名 */
  fileName: string | null;
}
