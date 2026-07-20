import { describe, expect, it } from 'vitest';
import { inferRecoveryFragments } from '../recoveryInference';
import { buildRecoveryArchiveJson, buildRecoveryExportBaseName, serializeRecoveryJson } from '../recoveryExport';
import type { ArchiveChange, TimePoint } from '../../types';

function change(key: string, oldValue: string, newValue: string): ArchiveChange {
  const keyParts = key.split('-');
  return {
    key,
    keyParts,
    rootKey: keyParts[0],
    oldValue,
    newValue,
    changeType: oldValue === 'nil' ? 'create' : newValue === 'nil' ? 'delete' : oldValue === newValue ? 'noop' : 'update',
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
        change('82', '928207', '928210'),
      ]),
    ],
    expectedFields: [{ key: '74-20007-强化等级' }],
  });
}

describe('recovery export serializers', () => {
  it('serializes Archive JSON shape with root-slot mapping and fixed wrappers', () => {
    const parsed = JSON.parse(serializeRecoveryJson(sampleResult()));

    expect(parsed).not.toHaveProperty('version');
    expect(parsed['74']).toEqual({
      day_value: { type: 'int', value: 0 },
      data_value: {
        type: 'str',
        value: {
          '20007': {
            绑定状态: '0',
            物品数量: '100, "quoted"\nline',
          },
        },
      },
      data_type: { type: 'int', value: 4 },
    });
    expect(parsed['82']).toEqual({
      day_value: { type: 'int', value: 0 },
      data_value: { type: 'str', value: '928207' },
      data_type: { type: 'int', value: 4 },
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
    expect(Object.keys(JSON.parse(first)['74'].data_value.value['20007'])).toEqual(['物品数量', '绑定状态']);
  });

  it('builds safe export base names', () => {
    expect(buildRecoveryExportBaseName('player abc.csv')).toBe('player_abc');
    expect(buildRecoveryExportBaseName('')).toBe('archive_recovery');
  });
});
