import { describe, expect, it } from 'vitest';
import { inferRecoveryFragments } from '../recoveryInference';
import { buildRecoveryArchiveJson, buildRecoveryExportBaseName, serializeRecoveryJson } from '../recoveryExport';
import type { ArchiveChange, TimePoint } from '../../types';

function change(
  key: string,
  oldValue: string,
  newValue: string,
  limitMetadata?: ArchiveChange['limitMetadata'],
): ArchiveChange {
  const keyParts = key.split('-');
  return {
    key,
    keyParts,
    rootKey: keyParts[0],
    oldValue,
    newValue,
    changeType: oldValue === 'nil' ? 'create' : newValue === 'nil' ? 'delete' : oldValue === newValue ? 'noop' : 'update',
    ...(limitMetadata ? { limitMetadata } : {}),
  };
}

function tp(timestamp: string, changes: ArchiveChange[]): TimePoint {
  return { index: 0, timestamp: new Date(timestamp), changes };
}

function sampleResult() {
  return inferRecoveryFragments({
    identity: { fileName: 'player abc.csv', aid: '30344223' },
    targetStartTime: new Date('2026-03-20T10:00:00Z'),
    targetEndTime: new Date('2026-03-20T10:30:00Z'),
    generatedAt: new Date('2026-03-20T11:00:00Z'),
    timePoints: [
      tp('2026-03-20T10:05:00Z', [
        change('74-20007-物品数量', '100, "quoted"\nline', '50'),
        change('74-20007-绑定状态', '0', '1'),
        change('82', '928207', '928210', { dayValueOld: '17', dayValueNew: '18', maxValue: '999999' }),
      ]),
    ],
    expectedFields: [{ key: '74-20007-强化等级' }],
  });
}

describe('recovery export serializers', () => {
  it('serializes direct Archive slot fields without typed wrappers', () => {
    const parsed = JSON.parse(serializeRecoveryJson(sampleResult()));

    expect(parsed).not.toHaveProperty('version');
    expect(parsed['74']).toEqual({
      data_value: {
        '20007': {
          绑定状态: 0,
          物品数量: '100, "quoted"\nline',
        },
      },
      day_value: 0,
      data_type: 4,
    });
    expect(parsed['82']).toEqual({
      data_value: '928207',
      day_value: 17,
      data_type: 2,
    });
  });

  it('omits fields without proven recovery values from the Archive JSON export', () => {
    const archive = buildRecoveryArchiveJson(sampleResult());

    expect(JSON.stringify(archive)).not.toContain('强化等级');
  });

  it('keeps export ordering stable by numeric slot and nested key', () => {
    const first = serializeRecoveryJson(sampleResult());
    const second = serializeRecoveryJson(sampleResult());
    expect(second).toBe(first);
    expect(Object.keys(JSON.parse(first))).toEqual(['74', '82']);
    expect(Object.keys(JSON.parse(first)['74'].data_value['20007'])).toEqual(['物品数量', '绑定状态']);
  });

  it('infers scalar slot types while preserving scalar string values', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'types.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [
        change('7', 'true', 'false'),
        change('37', 'LV09', 'LV10'),
        change('82', '0012', '13'),
        change('90', 'Fix32(1.50)', 'Fix32(2.50)'),
      ])],
    });

    expect(buildRecoveryArchiveJson(result)).toEqual({
      '7': { data_value: 'true', day_value: 0, data_type: 1 },
      '37': { data_value: 'LV09', day_value: 0, data_type: 0 },
      '82': { data_value: '0012', day_value: 0, data_type: 2 },
      '90': { data_value: 'Fix32(1.50)', day_value: 0, data_type: 3 },
    });
  });

  it('parses structured values and preserves explicit empties and nil rollback markers', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'tables.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [
        change('3-10697', "{'等级': 77, '评分': 'Fix32(929.75)', '锁定': False}", 'nil'),
        change('3-10698', '{}', 'nil'),
        change('3-10699', '[]', 'nil'),
        change('3-10700', "{'__proto__': {'safe': 1}, 'constructor': 2}", 'nil'),
        change('3-10701-field', 'nil', '1'),
      ])],
    });

    const archive = buildRecoveryArchiveJson(result);
    expect(archive['3']).toEqual({
      data_value: {
        '10697': { 等级: 77, 评分: 'Fix32(929.75)', 锁定: false },
        '10698': {},
        '10699': [],
        '10700': JSON.parse('{"__proto__":{"safe":1},"constructor":2}'),
        '10701': { field: 'nil' },
      },
      day_value: 0,
      data_type: 4,
    });
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(archive)).toContain('"nil"');
    expect(JSON.stringify(archive)).toContain('"__proto__"');
  });

  it('applies overlapping evidence in reverse source order so earlier state wins', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'ordering.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:05:00Z', [
          change('10-entity', "{'level': 1}", "{'level': 2}"),
          change('11-entity-level', '1', '2'),
          change('12-entity-level', 'nil', '2'),
          change('13-entity', "{'level': 1}", "{'level': 2}"),
          change('13-entity-level', '2', '3'),
        ]),
        tp('2026-03-20T10:10:00Z', [
          change('10-entity-level', '2', '3'),
          change('11-entity', "{'level': 2, 'name': 'x'}", "{'level': 3, 'name': 'x'}"),
          change('12-entity', "{'level': 2, 'name': 'x'}", "{'level': 3, 'name': 'x'}"),
        ]),
      ],
    });

    const archive = buildRecoveryArchiveJson(result);
    expect(archive['10'].data_value).toEqual({ entity: { level: 1 } });
    expect(archive['11'].data_value).toEqual({ entity: { level: 1, name: 'x' } });
    expect(archive['12'].data_value).toEqual({ entity: { level: 'nil', name: 'x' } });
    expect(archive['13'].data_value).toEqual({ entity: { level: 1 } });
  });

  it('uses the earliest slot event for day_value independently of lexical field order', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'days.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:05:00Z', [change('139-z', '4', '5', { dayValueOld: '6', dayValueNew: '7', maxValue: '99' })]),
        tp('2026-03-20T10:10:00Z', [change('139-a', '9', '10', { dayValueOld: '12', dayValueNew: '13', maxValue: '99' })]),
        tp('2026-03-20T10:05:00Z', [change('140-z', '4', '5', { dayValueOld: '-1', dayValueNew: '0', maxValue: '99' })]),
        tp('2026-03-20T10:10:00Z', [change('140-a', '9', '10', { dayValueOld: '12', dayValueNew: '13', maxValue: '99' })]),
      ],
    });

    const archive = buildRecoveryArchiveJson(result);
    expect(archive['139'].day_value).toBe(6);
    expect(archive['140'].day_value).toBe(0);
  });

  it('does not mutate inference results while serializing', () => {
    const result = sampleResult();
    const before = structuredClone(result);
    serializeRecoveryJson(result);
    expect(result).toEqual(before);
  });

  it('preserves integer leaves outside the JavaScript safe-integer range', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'large-integers.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [
        change('3-direct', '9007199254740993', '0'),
        change('3-structured', "{'value': 9007199254740993}", 'nil'),
      ])],
    });

    expect(buildRecoveryArchiveJson(result)['3'].data_value).toEqual({
      direct: '9007199254740993',
      structured: { value: '9007199254740993' },
    });
  });

  it('preserves exact lowercase nil as a rollback marker', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'sentinels.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [
        change('10', 'nil', 'created'),
        change('11', 'null', 'changed'),
        change('12', 'None', 'changed'),
        change('13', 'NIL', 'changed'),
        change('14-values', "{'absent': nil, 'json': null, 'python': None, 'upper': NIL}", 'changed'),
        change('15-values', '[1, nil, 3]', 'changed'),
      ])],
    });

    expect(buildRecoveryArchiveJson(result)).toEqual({
      '10': { data_value: 'nil', day_value: 0, data_type: 0 },
      '11': { data_value: 'null', day_value: 0, data_type: 0 },
      '12': { data_value: 'None', day_value: 0, data_type: 0 },
      '13': { data_value: 'NIL', day_value: 0, data_type: 0 },
      '14': {
        data_value: { values: { absent: 'nil', json: null, python: null, upper: 'NIL' } },
        day_value: 0,
        data_type: 4,
      },
      '15': {
        data_value: { values: [1, 'nil', 3] },
        day_value: 0,
        data_type: 4,
      },
    });
  });

  it('converts arrays for non-index overlays and preserves nil at existing indices', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'array-overlays.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:05:00Z', [
          change('20-length', '7', '8'),
          change('21-1', 'nil', '2'),
        ]),
        tp('2026-03-20T10:10:00Z', [
          change('20', '[1, 2]', '[3, 4]'),
          change('21', '[1, 2, 3]', '[4, 5, 6]'),
        ]),
      ],
    });

    const archive = buildRecoveryArchiveJson(result);
    expect(archive['20'].data_value).toEqual({ '0': 1, '1': 2, length: 7 });
    expect(archive['21'].data_value).toEqual([1, 'nil', 3]);
  });

  it('keeps nil markers for newly created slot 89 table entries', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'slot-89.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [
        change('89-14822', 'nil', '{}'),
        change('89-14822-宝石ID', 'nil', '20015'),
        change('89-14822-宝石部位', 'nil', '4'),
      ])],
    });

    expect(buildRecoveryArchiveJson(result)['89']).toEqual({
      data_value: {
        '14822': 'nil',
      },
      day_value: 0,
      data_type: 4,
    });
  });

  it('converts arrays before writing an index without an existing element', () => {
    const result = inferRecoveryFragments({
      identity: { fileName: 'array-holes.csv' },
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:05:00Z', [change('30-3', '4', '5')]),
        tp('2026-03-20T10:10:00Z', [change('30', '[1]', '[2]')]),
      ],
    });

    expect(buildRecoveryArchiveJson(result)['30'].data_value).toEqual({ '0': 1, '3': 4 });
  });

  it('builds safe export base names', () => {
    expect(buildRecoveryExportBaseName('player abc.csv')).toBe('player_abc');
    expect(buildRecoveryExportBaseName('')).toBe('archive_recovery');
  });
});
