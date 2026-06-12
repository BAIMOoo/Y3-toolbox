import { describe, it, expect } from 'vitest';
import { filterSnapshot } from '../filterSnapshot';

describe('filterSnapshot', () => {
  const snapshot = {
    '89': { '12572': { '宝石ID': '1001' }, '12573': { '宝石ID': '1002' } },
    '90': { '100': { '等级': '5' } },
    '91': { '200': { 'HP': '999' } },
  };

  it('should return original snapshot when rootKeys is empty', () => {
    const result = filterSnapshot(snapshot, []);
    expect(result).toBe(snapshot); // 引用相同，零开销
  });

  it('should return only selected rootKey subtree', () => {
    const result = filterSnapshot(snapshot, ['89']);
    expect(result).toEqual({
      '89': { '12572': { '宝石ID': '1001' }, '12573': { '宝石ID': '1002' } },
    });
    expect(Object.keys(result)).toEqual(['89']);
  });

  it('should return multiple selected rootKey subtrees', () => {
    const result = filterSnapshot(snapshot, ['89', '91']);
    expect(result).toEqual({
      '89': { '12572': { '宝石ID': '1001' }, '12573': { '宝石ID': '1002' } },
      '91': { '200': { 'HP': '999' } },
    });
  });

  it('should ignore non-existent rootKeys', () => {
    const result = filterSnapshot(snapshot, ['999']);
    expect(result).toEqual({});
  });

  it('should handle empty snapshot', () => {
    const result = filterSnapshot({}, ['89']);
    expect(result).toEqual({});
  });

  it('should handle null/undefined snapshot defensively', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing defensive behavior with invalid input
    expect(filterSnapshot(null as any, ['89'])).toEqual({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing defensive behavior with invalid input
    expect(filterSnapshot(undefined as any, ['89'])).toEqual({});
  });
});
