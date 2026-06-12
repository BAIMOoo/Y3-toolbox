// src/engine/__tests__/filterDiffLines.test.ts
import { describe, it, expect } from 'vitest';
import { filterUnchangedRootSubtrees, computeVisibleLines } from '../filterDiffLines';
import type { DiffLine } from '../diffLines';

/** 辅助：创建叶子行 */
function leaf(fullKey: string, type: DiffLine['type'], indent = 0): DiffLine {
  return {
    left: { text: `${fullKey}: val`, indent, fullKey },
    right: { text: `${fullKey}: val`, indent, fullKey },
    type,
  };
}

/** 辅助：创建对象开始行 */
function objOpen(key: string, type: DiffLine['type'] = 'unchanged', indent = 0): DiffLine {
  return {
    left: { text: `${key}:`, indent, fullKey: key, isObjectStart: true },
    right: { text: `${key}:`, indent, fullKey: key, isObjectStart: true },
    type,
  };
}

/** 辅助：创建对象结束行 */
function objClose(key: string, type: DiffLine['type'] = 'unchanged', indent = 0): DiffLine {
  return {
    left: { text: '}', indent, fullKey: `${key}-}`, isObjectEnd: true },
    right: { text: '}', indent, fullKey: `${key}-}`, isObjectEnd: true },
    type,
  };
}

describe('filterUnchangedRootSubtrees', () => {
  it('保留有变动的根键子树', () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      leaf('89-y', 'unchanged', 1),
      objClose('89'),
    ];
    const result = filterUnchangedRootSubtrees(lines);
    expect(result).toHaveLength(4);
  });

  it('移除完全无变动的根键子树', () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      objClose('89'),
      objOpen('90'),
      leaf('90-a', 'unchanged', 1),
      leaf('90-b', 'unchanged', 1),
      objClose('90'),
    ];
    const result = filterUnchangedRootSubtrees(lines);
    expect(result).toHaveLength(3); // 只剩 89 的 3 行
    expect(result[0].left?.fullKey).toBe('89');
  });

  it('保留根级变动的叶子行', () => {
    const lines: DiffLine[] = [
      leaf('a', 'updated'),
      leaf('b', 'unchanged'),
    ];
    const result = filterUnchangedRootSubtrees(lines);
    expect(result).toHaveLength(1);
    expect(result[0].left?.fullKey).toBe('a');
  });

  it('保留 created 类型的根键子树', () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'unchanged', 1),
      objClose('89'),
      { left: null, right: { text: 'new:', indent: 0, fullKey: 'new', isObjectStart: true }, type: 'created' as const },
      { left: null, right: { text: 'v: 1', indent: 1, fullKey: 'new-v' }, type: 'created' as const },
      { left: null, right: { text: '}', indent: 0, fullKey: 'new-}', isObjectEnd: true }, type: 'created' as const },
    ];
    const result = filterUnchangedRootSubtrees(lines);
    // 89 全 unchanged 被移除，new 是 created 保留
    expect(result).toHaveLength(3);
    expect(result[0].right?.fullKey).toBe('new');
  });

  it('空列表返回空', () => {
    expect(filterUnchangedRootSubtrees([])).toHaveLength(0);
  });

  it('所有根键都有变动 → 不过滤', () => {
    const lines: DiffLine[] = [
      objOpen('a'),
      leaf('a-x', 'created', 1),
      objClose('a'),
      objOpen('b'),
      leaf('b-y', 'deleted', 1),
      objClose('b'),
    ];
    const result = filterUnchangedRootSubtrees(lines);
    expect(result).toHaveLength(6);
  });

  it('处理 left 为 null 的行（created 类型）取 right 的 indent', () => {
    const lines: DiffLine[] = [
      { left: null, right: { text: 'x: 1', indent: 0, fullKey: 'x' }, type: 'created' as const },
    ];
    const result = filterUnchangedRootSubtrees(lines);
    expect(result).toHaveLength(1);
  });

  it('保留 deleted 类型的根键子树', () => {
    const lines: DiffLine[] = [
      objOpen('89', 'deleted'),
      { ...leaf('89-x', 'deleted', 1) },
      objClose('89', 'deleted'),
    ];
    const result = filterUnchangedRootSubtrees(lines);
    expect(result).toHaveLength(3);
  });

  it('包含嵌套子对象的根键子树正确处理', () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      objOpen('89-sub', 'unchanged', 1),
      leaf('89-sub-x', 'unchanged', 2),
      objClose('89-sub', 'unchanged', 1),
      leaf('89-y', 'updated', 1),
      objClose('89'),
    ];
    const result = filterUnchangedRootSubtrees(lines);
    // 89 内有 updated 行，整棵树保留
    expect(result).toHaveLength(6);
  });

  it('嵌套子对象的根键子树全部 unchanged 被移除', () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      objOpen('89-sub', 'unchanged', 1),
      leaf('89-sub-x', 'unchanged', 2),
      objClose('89-sub', 'unchanged', 1),
      leaf('89-y', 'unchanged', 1),
      objClose('89'),
    ];
    const result = filterUnchangedRootSubtrees(lines);
    expect(result).toHaveLength(0);
  });
});

/** 辅助：创建带 foldId 的行（模拟未变动可折叠子节点） */
function leafWithFold(fullKey: string, foldId: string, indent = 1): DiffLine {
  return {
    left: { text: `${fullKey}: val`, indent, fullKey },
    right: { text: `${fullKey}: val`, indent, fullKey },
    type: 'unchanged',
    foldId,
  };
}

function objOpenWithFold(key: string, foldId: string, indent = 1): DiffLine {
  return {
    left: { text: `${key}:`, indent, fullKey: key, isObjectStart: true },
    right: { text: `${key}:`, indent, fullKey: key, isObjectStart: true },
    type: 'unchanged',
    foldId,
    isFoldHeader: true,
  };
}

function objCloseWithFold(key: string, foldId: string, indent = 1): DiffLine {
  return {
    left: { text: '}', indent, fullKey: `${key}-}`, isObjectEnd: true },
    right: { text: '}', indent, fullKey: `${key}-}`, isObjectEnd: true },
    type: 'unchanged',
    foldId,
  };
}

describe('computeVisibleLines', () => {
  // ─── 'all' 模式 ───────────────────────────────────────────────
  it("'all' 模式：所有行均可见（无折叠时）", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      leaf('89-y', 'unchanged', 1),
      objClose('89'),
      objOpen('90'),
      leaf('90-a', 'unchanged', 1),
      objClose('90'),
    ];
    const result = computeVisibleLines(lines, 'all', new Set());
    expect(result).toHaveLength(7);
  });

  it("'all' 模式：collapsedFolds 中的折叠子树隐藏内容行，只显示 header", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      objOpenWithFold('89-sub', '89-sub'),
      leafWithFold('89-sub-a', '89-sub', 2),
      objCloseWithFold('89-sub', '89-sub'),
      objClose('89'),
    ];
    const collapsedFolds = new Set(['89-sub']);
    const result = computeVisibleLines(lines, 'all', collapsedFolds);
    // header 可见，leafWithFold 和 objCloseWithFold 被隐藏
    const subLines = result.filter(l => l.foldId === '89-sub');
    expect(subLines).toHaveLength(1);
    expect(subLines[0].isFoldHeader).toBe(true);
  });

  // ─── 'context' 模式 ───────────────────────────────────────────
  it("'context' 模式：无变动根键子树被移除", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      objClose('89'),
      objOpen('90'),
      leaf('90-a', 'unchanged', 1),
      objClose('90'),
    ];
    const result = computeVisibleLines(lines, 'context', new Set());
    // 90 全无变动被移除，只剩 89 的 3 行
    expect(result).toHaveLength(3);
    expect(result[0].left?.fullKey).toBe('89');
  });

  it("'context' 模式：有变动子树内的未变动兄弟 key 全部显示", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      objOpen('89-12469', 'unchanged', 1),
      leaf('89-12469-宝石ID', 'unchanged', 2),
      leaf('89-12469-背包位置', 'updated', 2),
      leaf('89-12469-宝石部位', 'unchanged', 2),
      objClose('89-12469', 'unchanged', 1),
      objClose('89'),
    ];
    const result = computeVisibleLines(lines, 'context', new Set());
    expect(result).toHaveLength(7);
    expect(result.find(l => l.left?.fullKey === '89-12469-宝石ID')).toBeDefined();
    expect(result.find(l => l.left?.fullKey === '89-12469-宝石部位')).toBeDefined();
  });

  it("'context' 模式：collapsedFolds 正常生效（与 'all' 折叠行为一致）", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      objOpenWithFold('89-sub', '89-sub'),
      leafWithFold('89-sub-a', '89-sub', 2),
      objCloseWithFold('89-sub', '89-sub'),
      objClose('89'),
    ];
    const collapsedFolds = new Set(['89-sub']);
    const result = computeVisibleLines(lines, 'context', collapsedFolds);
    // header 可见，内容行被折叠
    const subLines = result.filter(l => l.foldId === '89-sub');
    expect(subLines).toHaveLength(1);
    expect(subLines[0].isFoldHeader).toBe(true);
  });

  // ─── 'diff' 模式 ──────────────────────────────────────────────
  it("'diff' 模式：无变动根键子树被移除", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      objClose('89'),
      objOpen('90'),
      leaf('90-a', 'unchanged', 1),
      objClose('90'),
    ];
    const result = computeVisibleLines(lines, 'diff', new Set());
    // 90 被移除，89 内只有 updated 行 + 开闭结构行
    expect(result).toHaveLength(3);
    expect(result.find(l => l.left?.fullKey?.startsWith('90'))).toBeUndefined();
  });

  it("'diff' 模式：有变动子树内未变动叶子行被隐藏", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      objOpen('89-12469', 'unchanged', 1),
      leaf('89-12469-宝石ID', 'unchanged', 2),    // 应隐藏
      leaf('89-12469-背包位置', 'updated', 2),     // 应显示
      leaf('89-12469-宝石部位', 'unchanged', 2),   // 应隐藏
      objClose('89-12469', 'unchanged', 1),
      objClose('89'),
    ];
    const result = computeVisibleLines(lines, 'diff', new Set());
    // 可见行：89 开、89-12469 开（结构行）、背包位置（updated）、89-12469 关（结构行）、89 关 = 5 行
    expect(result).toHaveLength(5);
    expect(result.find(l => l.left?.fullKey === '89-12469-宝石ID')).toBeUndefined();
    expect(result.find(l => l.left?.fullKey === '89-12469-宝石部位')).toBeUndefined();
    expect(result.find(l => l.left?.fullKey === '89-12469-背包位置')).toBeDefined();
  });

  it("'diff' 模式：noop 行（变动日志中记录的条目）应保留显示", () => {
    // noop 类型代表「该变动存在于日志中但值未实际改变」，与 unchanged 语义不同
    // 'diff' 模式下 noop 行应保留，以与变动日志保持一致性
    const noopLeaf = (fullKey: string, indent = 2): DiffLine => ({
      left: { text: `${fullKey}: val`, indent, fullKey },
      right: { text: `${fullKey}: val`, indent, fullKey },
      type: 'noop',
    });
    const lines: DiffLine[] = [
      objOpen('89'),
      objOpen('89-12469', 'unchanged', 1),
      noopLeaf('89-12469-洗练ID'),               // noop，应保留
      leaf('89-12469-背包位置', 'updated', 2),    // 应保留
      leaf('89-12469-宝石ID', 'unchanged', 2),    // unchanged，应隐藏
      objClose('89-12469', 'unchanged', 1),
      objClose('89'),
    ];
    const result = computeVisibleLines(lines, 'diff', new Set());
    // noop 行保留
    expect(result.find(l => l.left?.fullKey === '89-12469-洗练ID')).toBeDefined();
    // updated 行保留
    expect(result.find(l => l.left?.fullKey === '89-12469-背包位置')).toBeDefined();
    // unchanged 叶子行隐藏
    expect(result.find(l => l.left?.fullKey === '89-12469-宝石ID')).toBeUndefined();
  });

  it("'diff' 模式：对象开闭结构行（isObjectStart/isObjectEnd）始终保留", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      objOpen('89-sub', 'unchanged', 1),
      leaf('89-sub-a', 'updated', 2),
      objClose('89-sub', 'unchanged', 1),
      objClose('89'),
    ];
    const result = computeVisibleLines(lines, 'diff', new Set());
    // 开闭行保留：89 开、89-sub 开、89-sub 关、89 关 + 变动叶子
    expect(result.find(l => l.left?.isObjectStart && l.left.fullKey === '89-sub')).toBeDefined();
    expect(result.find(l => l.left?.isObjectEnd && l.left.fullKey === '89-sub-}')).toBeDefined();
  });

  it("'diff' 模式：foldId 行（未变动子树 header）全部被过滤", () => {
    const lines: DiffLine[] = [
      objOpen('89'),
      leaf('89-x', 'updated', 1),
      objOpenWithFold('89-sub', '89-sub'),   // foldId 行，应被隐藏
      leafWithFold('89-sub-a', '89-sub', 2), // foldId 行，应被隐藏
      objCloseWithFold('89-sub', '89-sub'),  // foldId 行，应被隐藏
      objClose('89'),
    ];
    const result = computeVisibleLines(lines, 'diff', new Set(['89-sub']));
    // foldId 行全部不可见（'diff' 模式不走折叠逻辑，直接过滤 unchanged 行）
    expect(result.filter(l => l.foldId)).toHaveLength(0);
  });
});
