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


  describe('UTF-8 hex escape decoding', () => {
    it('decodes Python-style UTF-8 hex escapes in values', () => {
      const changes = parseArchiveDiff("|89-12514={'\\xe6\\xa0\\x8f\\xe4\\xbd\\x8d1': 0, '\\xe6\\xb4\\x97\\xe7\\xbb\\x83ID': 7}>>>nil");

      expect(changes[0].oldValue).toBe("{'栏位1': 0, '洗练ID': 7}");
      expect(changes[0].newValue).toBe('nil');
    });

    it('decodes UTF-8 hex escapes in keys before deriving key parts', () => {
      const changes = parseArchiveDiff('|89-12514-\\xe6\\xa0\\x8f\\xe4\\xbd\\x8d1=0>>>1');

      expect(changes[0].key).toBe('89-12514-栏位1');
      expect(changes[0].keyParts).toEqual(['89', '12514', '栏位1']);
      expect(changes[0].rootKey).toBe('89');
    });

    it('leaves non-hex escapes untouched', () => {
      const changes = parseArchiveDiff('|1=line\\ntext>>>line\\ttext');

      expect(changes[0].oldValue).toBe('line\\ntext');
      expect(changes[0].newValue).toBe('line\\ttext');
    });

    it('leaves invalid UTF-8 hex byte sequences untouched', () => {
      const changes = parseArchiveDiff('|1=bad\\xfftext>>>ok');

      expect(changes[0].oldValue).toBe('bad\\xfftext');
    });

    it('decodes the real recovery CSV byte-escaped table sample', () => {
      const changes = parseArchiveDiff("|89-12355={'\\xe6\\xa0\\x8f\\xe4\\xbd\\x8d1': 0, '\\xe6\\x98\\xaf\\xe5\\x90\\xa6\\xe9\\x94\\x81\\xe5\\xae\\x9a': 0, '\\xe8\\x83\\x8c\\xe5\\x8c\\x85\\xe4\\xbd\\x8d\\xe7\\xbd\\xae': 56}>>nil>>>3>>0");

      expect(changes[0].oldValue).toContain("'栏位1': 0");
      expect(changes[0].oldValue).toContain("'是否锁定': 0");
      expect(changes[0].oldValue).toContain("'背包位置': 56");
    });
  });

  describe('platform limit metadata', () => {
    it('keeps bracketed dv/max metadata from splitting into fake archive keys', () => {
      const changes = parseArchiveDiff(
        '|82=225014>>>225015[dv:14114>>18559|max:99999999]|244-1=16078>>16079>>>1>>16079',
      );

      expect(changes).toHaveLength(2);
      expect(changes.map((change) => change.key)).toEqual(['82', '244-1']);
      expect(changes.find((change) => change.key === 'max:99999999]')).toBeUndefined();
    });

    it('strips CheckMapArchiveDiff day-value/max metadata from snapshot values', () => {
      const changes = parseArchiveDiff('|82=225014>>>225015[dv:14114>>18559|max:99999999]');

      expect(changes[0]).toEqual({
        key: '82',
        keyParts: ['82'],
        rootKey: '82',
        oldValue: '225014',
        newValue: '225015',
        changeType: 'update',
        limitMetadata: {
          dayValueOld: '14114',
          dayValueNew: '18559',
          maxValue: '99999999',
        },
      });
    });

    it('supports other platform max limits without treating metadata as value text', () => {
      const changes = parseArchiveDiff('|143=2638>>>2640[dv:400>>402|max:99999]');

      expect(changes[0].oldValue).toBe('2638');
      expect(changes[0].newValue).toBe('2640');
      expect(changes[0].limitMetadata).toEqual({
        dayValueOld: '400',
        dayValueNew: '402',
        maxValue: '99999',
      });
    });
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
