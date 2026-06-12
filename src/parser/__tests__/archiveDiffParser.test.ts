import { describe, it, expect } from 'vitest';
import { parseArchiveDiff, extractArchiveDiff } from '../archiveDiffParser';

describe('extractArchiveDiff', () => {
  it('should extract archive_diff from JSON log line', () => {
    const raw = 'Mar 19 14:22:26 up5 UP5_GameStatistic: [2026-03-19 14:22:26 +0800][MapArchiveUpload],{"game_server":"game_3","archive_diff":"|100=40112>>>40154|89-12572=nil>>>{}"}';
    const diff = extractArchiveDiff(raw);
    expect(diff).toBe('|100=40112>>>40154|89-12572=nil>>>{}');
  });
  it('should return null if no archive_diff found', () => {
    expect(extractArchiveDiff('some random text')).toBeNull();
  });
});

describe('parseArchiveDiff', () => {
  it('should parse simple key=old>>>new entries', () => {
    const changes = parseArchiveDiff('|100=40112>>>40154|103=119165>>>119291');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      key: '100', keyParts: ['100'], rootKey: '100',
      oldValue: '40112', newValue: '40154', changeType: 'update',
    });
  });
  it('should parse nested keys with dash separator', () => {
    const changes = parseArchiveDiff('|89-12572-宝石ID=nil>>>20014');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      key: '89-12572-宝石ID', keyParts: ['89', '12572', '宝石ID'], rootKey: '89',
      oldValue: 'nil', newValue: '20014', changeType: 'create',
    });
  });
  it('should detect create when old is nil', () => {
    const changes = parseArchiveDiff('|89-12572=nil>>>{}');
    expect(changes[0].changeType).toBe('create');
  });
  it('should detect delete when new is nil', () => {
    const changes = parseArchiveDiff('|89-12514=something>>>nil');
    expect(changes[0].changeType).toBe('delete');
  });
  it('should detect update when both are non-nil', () => {
    const changes = parseArchiveDiff('|100=40112>>>40154');
    expect(changes[0].changeType).toBe('update');
  });
  it('should handle Fix32 values', () => {
    const changes = parseArchiveDiff('|74-20002-物品数量=Fix32(4502.00)>>>Fix32(4544.00)');
    expect(changes[0].oldValue).toBe('Fix32(4502.00)');
    expect(changes[0].newValue).toBe('Fix32(4544.00)');
    expect(changes[0].changeType).toBe('update');
  });
  it('should handle values containing = by splitting on first =', () => {
    const changes = parseArchiveDiff("|89-12514={'栏位1': 0}>>>nil");
    expect(changes[0].key).toBe('89-12514');
    expect(changes[0].oldValue).toBe("{'栏位1': 0}");
    expect(changes[0].newValue).toBe('nil');
    expect(changes[0].changeType).toBe('delete');
  });
  it('should handle same old and new values (noop)', () => {
    const changes = parseArchiveDiff('|90-81=12544>>>12544');
    expect(changes[0].changeType).toBe('noop');
  });
  it('should handle empty diff string', () => {
    expect(parseArchiveDiff('')).toEqual([]);
  });

  describe('new format with op_type and final_value', () => {
    it('should parse new format: key=old>>new>>>op_type>>final_value', () => {
      const changes = parseArchiveDiff('|74-20007-物品名称=考古币>>考古币>>>1>>考古币');
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        key: '74-20007-物品名称',
        keyParts: ['74', '20007', '物品名称'],
        rootKey: '74',
        oldValue: '考古币',
        newValue: '考古币',
        changeType: 'noop',
      });
    });

    it('should parse new format with Fix32 values', () => {
      const changes = parseArchiveDiff('|74-20007-物品数量=Fix32(15707.00)>>Fix32(15710.00)>>>1>>15710.0');
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        key: '74-20007-物品数量',
        keyParts: ['74', '20007', '物品数量'],
        rootKey: '74',
        oldValue: 'Fix32(15707.00)',
        newValue: 'Fix32(15710.00)',
        changeType: 'update',
      });
    });

    it('should parse mixed old and new formats', () => {
      const changes = parseArchiveDiff('|82=928207>>>928210|74-20007-物品名称=考古币>>考古币>>>1>>考古币');
      expect(changes).toHaveLength(2);
      // 旧格式
      expect(changes[0]).toEqual({
        key: '82',
        keyParts: ['82'],
        rootKey: '82',
        oldValue: '928207',
        newValue: '928210',
        changeType: 'update',
      });
      // 新格式
      expect(changes[1]).toEqual({
        key: '74-20007-物品名称',
        keyParts: ['74', '20007', '物品名称'],
        rootKey: '74',
        oldValue: '考古币',
        newValue: '考古币',
        changeType: 'noop',
      });
    });

    it('should handle new format with different op_types', () => {
      // op_type: 1=SET, 2=ADD, 3=REMOVE, 4=MULTIPLY, 5=COPY
      const changes = parseArchiveDiff('|100=670>>770>>>2>>770|128=5>>10>>>4>>50');
      expect(changes).toHaveLength(2);
      expect(changes[0].oldValue).toBe('670');
      expect(changes[0].newValue).toBe('770');
      expect(changes[1].oldValue).toBe('5');
      expect(changes[1].newValue).toBe('10');
    });
  });
});
