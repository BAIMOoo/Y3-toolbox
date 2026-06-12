// src/engine/__tests__/diffLines.test.ts
import { describe, it, expect } from 'vitest';
import { buildAlignedLines } from '../diffLines';

describe('buildAlignedLines', () => {
  describe('基础叶子节点对齐', () => {
    it('相同快照 → 所有行 unchanged', () => {
      const prev = { a: '1', b: '2' };
      const curr = { a: '1', b: '2' };
      const changed = new Set<string>();
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines).toHaveLength(2);
      expect(lines.every(l => l.type === 'unchanged')).toBe(true);
      expect(lines[0].left?.text).toBe('a: 1');
      expect(lines[0].right?.text).toBe('a: 1');
      expect(lines[1].left?.text).toBe('b: 2');
      expect(lines[1].right?.text).toBe('b: 2');
    });

    it('值更新 → updated 行，左右内容不同', () => {
      const prev = { a: '1' };
      const curr = { a: '2' };
      const changed = new Set(['a']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines).toHaveLength(1);
      expect(lines[0].type).toBe('updated');
      expect(lines[0].left?.text).toBe('a: 1');
      expect(lines[0].right?.text).toBe('a: 2');
    });

    it('新增键 → created，left 为 null', () => {
      const prev = { a: '1' };
      const curr = { a: '1', b: '2' };
      const changed = new Set(['b']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines).toHaveLength(2);
      expect(lines[0].type).toBe('unchanged');
      expect(lines[1].type).toBe('created');
      expect(lines[1].left).toBeNull();
      expect(lines[1].right?.text).toBe('b: 2');
    });

    it('删除键 → deleted，right 有内容（删除线用）', () => {
      const prev = { a: '1', b: '2' };
      const curr = { a: '1' };
      const changed = new Set(['b']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines).toHaveLength(2);
      expect(lines[1].type).toBe('deleted');
      expect(lines[1].left?.text).toBe('b: 2');
      expect(lines[1].right?.text).toBe('b: 2');
      expect(lines[1].right?.fullKey).toBe('b');
    });

    it('键按字母序排列', () => {
      const prev = { c: '3', a: '1', b: '2' };
      const curr = { c: '3', a: '1', b: '2' };
      const changed = new Set<string>();
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines.map(l => l.left?.fullKey)).toEqual(['a', 'b', 'c']);
    });

    it('空快照 → 所有行 created', () => {
      const prev = {};
      const curr = { a: '1', b: '2' };
      const changed = new Set(['a', 'b']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines).toHaveLength(2);
      expect(lines.every(l => l.type === 'created')).toBe(true);
      expect(lines.every(l => l.left === null)).toBe(true);
    });

    it('两侧都空 → 空数组', () => {
      const lines = buildAlignedLines({}, {}, new Set());
      expect(lines).toHaveLength(0);
    });
  });

  describe('嵌套对象对齐', () => {
    it('两侧都有的嵌套对象 — 生成 { 和 } 行', () => {
      const prev = { a: { x: '1' } };
      const curr = { a: { x: '2' } };
      const changed = new Set(['a-x']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines[0].left?.isObjectStart).toBe(true);
      expect(lines[0].left?.text).toBe('a:');
      expect(lines[0].type).toBe('unchanged');
      expect(lines[1].type).toBe('updated');
      expect(lines[1].left?.text).toBe('x: 1');
      expect(lines[1].left?.indent).toBe(1);
      expect(lines[1].right?.text).toBe('x: 2');
      expect(lines[2].left?.isObjectEnd).toBe(true);
    });

    it('仅右侧有的嵌套对象 — 左侧全部占位', () => {
      const prev = {};
      const curr = { a: { x: '1', y: '2' } };
      const changed = new Set(['a-x', 'a-y']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines[0].left).toBeNull();
      expect(lines[0].right?.isObjectStart).toBe(true);
      expect(lines[0].type).toBe('created');
      expect(lines[1].left).toBeNull();
      expect(lines[1].type).toBe('created');
      expect(lines[2].left).toBeNull();
      expect(lines[3].left).toBeNull();
      expect(lines[3].right?.isObjectEnd).toBe(true);
    });

    it('仅左侧有的嵌套对象 — 右侧删除线', () => {
      const prev = { a: { x: '1' } };
      const curr = {};
      const changed = new Set(['a-x']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines[0].type).toBe('deleted');
      expect(lines[0].left?.isObjectStart).toBe(true);
      expect(lines[0].right?.isObjectStart).toBe(true);
      expect(lines[1].type).toBe('deleted');
      expect(lines[1].right?.text).toBe('x: 1');
      expect(lines[2].type).toBe('deleted');
    });

    it('混合场景 — create/update/delete 行对齐', () => {
      const prev = { a: { x: '1', y: '2' } };
      const curr = { a: { x: '3', z: '4' } };
      const changed = new Set(['a-x', 'a-y', 'a-z']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines[0].type).toBe('unchanged');
      const xLine = lines.find(l => l.left?.fullKey === 'a-x' || l.right?.fullKey === 'a-x');
      const yLine = lines.find(l => l.left?.fullKey === 'a-y');
      const zLine = lines.find(l => l.right?.fullKey === 'a-z');
      expect(xLine?.type).toBe('updated');
      expect(yLine?.type).toBe('deleted');
      expect(zLine?.type).toBe('created');
      expect(zLine?.left).toBeNull();
    });

    it('深层嵌套 — 3 层', () => {
      const prev = { a: { b: { c: '1' } } };
      const curr = { a: { b: { c: '2' } } };
      const changed = new Set(['a-b-c']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines.length).toBe(5);
      expect(lines[2].left?.indent).toBe(2);
      expect(lines[2].type).toBe('updated');
    });
  });

  describe('折叠标记', () => {
    it('未变动子树 — 所有行有 foldId，首行有 isFoldHeader', () => {
      const prev = { a: { x: '1', y: '2' } };
      const curr = { a: { x: '1', y: '2' } };
      const changed = new Set<string>();
      const lines = buildAlignedLines(prev, curr, changed);
      const foldLines = lines.filter(l => l.foldId);
      expect(foldLines.length).toBeGreaterThan(0);
      expect(foldLines[0].foldId).toBe('a');
      expect(foldLines[0].isFoldHeader).toBe(true);
      expect(foldLines.slice(1).every(l => !l.isFoldHeader)).toBe(true);
    });

    it('有变动的子树 — 不标记 foldId', () => {
      const prev = { a: { x: '1' } };
      const curr = { a: { x: '2' } };
      const changed = new Set(['a-x']);
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines.every(l => !l.foldId)).toBe(true);
    });

    it('混合子树 — 仅未变动的子树有 foldId', () => {
      const prev = { a: { x: '1' }, b: { y: '2' } };
      const curr = { a: { x: '3' }, b: { y: '2' } };
      const changed = new Set(['a-x']);
      const lines = buildAlignedLines(prev, curr, changed);
      const aLines = lines.filter(l => (l.left?.fullKey?.startsWith('a') || l.right?.fullKey?.startsWith('a')));
      expect(aLines.every(l => !l.foldId)).toBe(true);
      const bLines = lines.filter(l => l.foldId === 'b');
      expect(bLines.length).toBeGreaterThan(0);
    });

    it('叶子节点不标记 foldId', () => {
      const prev = { a: '1' };
      const curr = { a: '1' };
      const changed = new Set<string>();
      const lines = buildAlignedLines(prev, curr, changed);
      expect(lines[0].foldId).toBeUndefined();
    });
  });
});
