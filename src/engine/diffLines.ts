// src/engine/diffLines.ts
import type { Snapshot, SnapshotValue } from '../types';

/** 行类型 */
export type DiffLineType =
  | 'unchanged'
  | 'updated'
  | 'created'
  | 'deleted'
  | 'noop';

/** 单侧行内容 */
export interface DiffLineContent {
  text: string;
  indent: number;
  fullKey: string;
  isObjectStart?: boolean;
  isObjectEnd?: boolean;
}

/** 一行 = 左侧 + 右侧 */
export interface DiffLine {
  left: DiffLineContent | null;
  right: DiffLineContent | null;
  type: DiffLineType;
  foldId?: string;
  isFoldHeader?: boolean;
}

/**
 * 生成对齐的双栏行列表。
 * 合并两个快照的键集合，逐键比较生成统一行。
 */
export function buildAlignedLines(
  prevSnapshot: Snapshot,
  currentSnapshot: Snapshot,
  changedKeys: Set<string>,
  noopKeys?: Set<string>,
): DiffLine[] {
  return buildLines(prevSnapshot, currentSnapshot, changedKeys, noopKeys ?? new Set(), '', 0);
}

/** 检查以 prefix 开头的键是否在 changedKeys 中存在 */
function hasChangedDescendant(prefix: string, changedKeys: Set<string>): boolean {
  for (const key of changedKeys) {
    if (key === prefix || key.startsWith(prefix + '-')) {
      return true;
    }
  }
  return false;
}

function buildLines(
  prev: Record<string, SnapshotValue>,
  curr: Record<string, SnapshotValue>,
  changedKeys: Set<string>,
  noopKeys: Set<string>,
  prefix: string,
  depth: number,
): DiffLine[] {
  const lines: DiffLine[] = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  const sortedKeys = [...allKeys].sort();

  for (const key of sortedKeys) {
    const fullKey = prefix ? `${prefix}-${key}` : key;
    const inPrev = key in prev;
    const inCurr = key in curr;
    const prevVal = prev[key];
    const currVal = curr[key];
    const prevIsObj = inPrev && typeof prevVal === 'object' && prevVal !== null;
    const currIsObj = inCurr && typeof currVal === 'object' && currVal !== null;

    if (inPrev && inCurr) {
      if (prevIsObj && currIsObj) {
        // 两侧都是对象 → 生成 "key: {" 行，递归，生成 "}" 行
        const subtreeChanged = hasChangedDescendant(fullKey, changedKeys);
        const childLines = buildLines(
          prevVal as Record<string, SnapshotValue>,
          currVal as Record<string, SnapshotValue>,
          changedKeys, noopKeys, fullKey, depth + 1,
        );

        const openLine: DiffLine = {
          left: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          right: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          type: 'unchanged',
        };
        const closeLine: DiffLine = {
          left: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          right: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          type: 'unchanged',
        };

        if (!subtreeChanged) {
          // 未变动子树 → 标记 foldId
          openLine.foldId = fullKey;
          openLine.isFoldHeader = true;
          closeLine.foldId = fullKey;
          for (const cl of childLines) {
            cl.foldId = fullKey;
          }
        }

        lines.push(openLine);
        lines.push(...childLines);
        lines.push(closeLine);
      } else if (prevIsObj && !currIsObj) {
        // 左侧是对象，右侧变成了叶子
        const deletedLines = flattenObject(prevVal as Record<string, SnapshotValue>, fullKey, depth + 1);
        lines.push({
          left: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          right: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          type: 'deleted',
        });
        for (const dl of deletedLines) {
          lines.push({ left: dl, right: { ...dl }, type: 'deleted' });
        }
        lines.push({
          left: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          right: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          type: 'deleted',
        });
        lines.push({
          left: null,
          right: { text: `${key}: ${String(currVal)}`, indent: depth, fullKey },
          type: 'created',
        });
      } else if (!prevIsObj && currIsObj) {
        // 左侧是叶子，右侧变成了对象
        lines.push({
          left: { text: `${key}: ${String(prevVal)}`, indent: depth, fullKey },
          right: { text: `${key}: ${String(prevVal)}`, indent: depth, fullKey },
          type: 'deleted',
        });
        lines.push({
          left: null,
          right: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          type: 'created',
        });
        const createdLines = flattenObject(currVal as Record<string, SnapshotValue>, fullKey, depth + 1);
        for (const cl of createdLines) {
          lines.push({ left: null, right: cl, type: 'created' });
        }
        lines.push({
          left: null,
          right: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          type: 'created',
        });
      } else {
        // 两侧都是叶子
        const isNoop = noopKeys.has(fullKey);
        const isChanged = changedKeys.has(fullKey);
        lines.push({
          left: { text: `${key}: ${String(prevVal)}`, indent: depth, fullKey },
          right: { text: `${key}: ${String(currVal)}`, indent: depth, fullKey },
          type: isNoop ? 'noop' : isChanged ? 'updated' : 'unchanged',
        });
      }
    } else if (inPrev && !inCurr) {
      // 仅左侧有 → deleted
      if (prevIsObj) {
        lines.push({
          left: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          right: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          type: 'deleted',
        });
        const deletedLines = flattenObject(prevVal as Record<string, SnapshotValue>, fullKey, depth + 1);
        for (const dl of deletedLines) {
          lines.push({ left: dl, right: { ...dl }, type: 'deleted' });
        }
        lines.push({
          left: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          right: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          type: 'deleted',
        });
      } else {
        lines.push({
          left: { text: `${key}: ${String(prevVal)}`, indent: depth, fullKey },
          right: { text: `${key}: ${String(prevVal)}`, indent: depth, fullKey },
          type: 'deleted',
        });
      }
    } else if (!inPrev && inCurr) {
      // 仅右侧有 → created
      if (currIsObj) {
        lines.push({
          left: null,
          right: { text: `${key}:`, indent: depth, fullKey, isObjectStart: true },
          type: 'created',
        });
        const createdLines = flattenObject(currVal as Record<string, SnapshotValue>, fullKey, depth + 1);
        for (const cl of createdLines) {
          lines.push({ left: null, right: cl, type: 'created' });
        }
        lines.push({
          left: null,
          right: { text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true },
          type: 'created',
        });
      } else {
        lines.push({
          left: null,
          right: { text: `${key}: ${String(currVal)}`, indent: depth, fullKey },
          type: 'created',
        });
      }
    }
  }

  return lines;
}

/** 将一个对象的所有键递归展平为 DiffLineContent 列表（用于单侧对象） */
function flattenObject(
  obj: Record<string, SnapshotValue>,
  prefix: string,
  depth: number,
): DiffLineContent[] {
  const result: DiffLineContent[] = [];
  for (const key of Object.keys(obj).sort()) {
    const fullKey = `${prefix}-${key}`;
    const value = obj[key];
    if (typeof value === 'object' && value !== null) {
      result.push({ text: `${key}:`, indent: depth, fullKey, isObjectStart: true });
      result.push(...flattenObject(value, fullKey, depth + 1));
      result.push({ text: '}', indent: depth, fullKey: `${fullKey}-}`, isObjectEnd: true });
    } else {
      result.push({ text: `${key}: ${String(value)}`, indent: depth, fullKey });
    }
  }
  return result;
}
