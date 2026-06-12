// src/engine/filterDiffLines.ts
import type { DiffLine } from './diffLines';
import type { DisplayMode } from '../types';

/**
 * 过滤掉完全没有变动的根键子树。
 * 根键子树 = indent===0 的对象（从 isObjectStart 到 isObjectEnd），
 * 或 indent===0 的独立叶子行。
 *
 * 若子树内所有行 type 均为 'unchanged'，则移除整棵子树。
 */
export function filterUnchangedRootSubtrees(lines: DiffLine[]): DiffLine[] {
  // 第一步：将 lines 分割为根级"段落"
  const segments: { startIdx: number; endIdx: number; hasChange: boolean }[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const indent = getIndent(line);

    if (indent === 0 && isObjectStart(line)) {
      // 对象子树：找到对应的 indent===0 的 isObjectEnd
      const start = i;
      let hasChange = line.type !== 'unchanged';
      let depth = 1;
      i++;
      while (i < lines.length && depth > 0) {
        const curr = lines[i];
        if (curr.type !== 'unchanged') hasChange = true;
        if (getIndent(curr) === 0 && isObjectEnd(curr)) {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        } else if (getIndent(curr) === 0 && isObjectStart(curr)) {
          depth++;
        }
        i++;
      }
      segments.push({ startIdx: start, endIdx: i, hasChange });
    } else {
      // 独立叶子行
      segments.push({ startIdx: i, endIdx: i + 1, hasChange: line.type !== 'unchanged' });
      i++;
    }
  }

  // 第二步：只保留有变动的段落
  const result: DiffLine[] = [];
  for (const seg of segments) {
    if (seg.hasChange) {
      for (let j = seg.startIdx; j < seg.endIdx; j++) {
        result.push(lines[j]);
      }
    }
  }
  return result;
}

/**
 * 根据显示模式和折叠状态计算最终可见行列表。
 *
 * - 'all'：不过滤根键子树，直接走折叠逻辑。
 * - 'diff'：移除无变动根键子树，再隐藏有变动子树内的未变动叶子行
 *           （保留 isObjectStart/isObjectEnd 结构行作为容器，但 foldId 行例外）。
 *           foldId 行（buildAlignedLines 对未变动子树打标）优先过滤（collapsedFolds 在此模式下无效）。
 *           noop 行保留（代表「变动日志中有记录」，与 unchanged 语义不同）。
 * - 'context'：移除无变动根键子树，剩余行走折叠逻辑（与 'all' 完全一致）。
 *
 * DiffLine.isObjectStart / isObjectEnd 由 buildAlignedLines 赋值，
 * 表示该行是对象字面量的开/闭括号行（见 src/engine/diffLines.ts）。
 */
export function computeVisibleLines(
  lines: DiffLine[],
  displayMode: DisplayMode,
  collapsedFolds: ReadonlySet<string>,
): DiffLine[] {
  if (displayMode === 'diff') {
    const source = filterUnchangedRootSubtrees(lines);
    return source.filter(line => {
      // foldId 行（buildAlignedLines 对未变动子树打标）直接过滤，不论结构类型
      if (line.foldId) return false;
      // 仅过滤 unchanged 的非结构叶子行
      // noop 类型代表「变动日志中有记录」，应保留显示以与日志保持一致性
      if (line.type === 'unchanged') {
        const isStructural = !!(
          line.left?.isObjectStart || line.right?.isObjectStart ||
          line.left?.isObjectEnd  || line.right?.isObjectEnd
        );
        return isStructural;
      }
      return true;
    });
  }

  // 'all' 和 'context' 都走折叠逻辑；区别在于 'context' 先过滤无变动根键子树
  const source = displayMode === 'context'
    ? filterUnchangedRootSubtrees(lines)
    : lines;

  return source.filter(line => {
    if (!line.foldId) return true;
    if (line.isFoldHeader) return true;
    return !collapsedFolds.has(line.foldId);
  });
}

function getIndent(line: DiffLine): number {
  return line.left?.indent ?? line.right?.indent ?? 0;
}

function isObjectStart(line: DiffLine): boolean {
  return !!(line.left?.isObjectStart || line.right?.isObjectStart);
}

function isObjectEnd(line: DiffLine): boolean {
  return !!(line.left?.isObjectEnd || line.right?.isObjectEnd);
}
