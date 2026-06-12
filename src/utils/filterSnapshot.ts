import type { Snapshot } from '../types';

/**
 * 根据选中的根键列表裁剪快照，只保留匹配的顶层子树。
 * rootKeys 为空时返回原始快照引用（零开销）。
 *
 * @param snapshot 完整存档快照
 * @param rootKeys 选中的根键列表，空数组表示不裁剪
 * @returns 裁剪后的快照（浅拷贝），或原始引用（rootKeys 为空时）
 */
export function filterSnapshot(snapshot: Snapshot, rootKeys: string[]): Snapshot {
  if (snapshot == null) return {};
  if (rootKeys.length === 0) return snapshot;
  const filtered: Snapshot = {};
  for (const key of rootKeys) {
    if (key in snapshot) {
      filtered[key] = snapshot[key];
    }
  }
  return filtered;
}
