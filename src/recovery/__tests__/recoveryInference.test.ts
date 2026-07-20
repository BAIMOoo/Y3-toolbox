import { describe, expect, it } from 'vitest';
import type { ArchiveChange, TimePoint } from '../../types';
import { getSlotPrefix, inferRecoveryFragments, resolveRecoveryIdentity } from '../recoveryInference';
import { compareOrdinalStrings } from '../recoveryOrdering';

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

const identity = { fileName: 'player_abc.csv' };

describe('compareOrdinalStrings', () => {
  it('orders Chinese field names independently of the host locale', () => {
    expect(['绑定状态', '物品数量'].sort(compareOrdinalStrings)).toEqual(['物品数量', '绑定状态']);
  });
});

describe('inferRecoveryFragments', () => {
  it('sorts time points by default so direct callers with unsorted input remain correct', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:10:00Z', [change('74-20007-物品数量', '50', '30')]),
        tp('2026-03-20T10:05:00Z', [change('74-20007-物品数量', '100', '50')]),
      ],
    });

    expect(result.fields[0]).toMatchObject({
      recoveryValue: '100',
      sourceTimestamp: '2026-03-20T10:05:00.000Z',
    });
  });

  it('lets parser-fed callers opt into already-sorted time point order', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      assumeSortedTimePoints: true,
      timePoints: [
        tp('2026-03-20T10:05:00Z', [change('74-20007-物品数量', '100', '50')]),
        tp('2026-03-20T10:10:00Z', [change('74-20007-物品数量', '50', '30')]),
      ],
    });

    expect(result.fields[0]).toMatchObject({
      recoveryValue: '100',
      sourceTimestamp: '2026-03-20T10:05:00.000Z',
    });
  });

  it('uses the first post-target oldValue as the recovery value', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:05:00Z', [change('74-20007-物品数量', '100', '50')]),
        tp('2026-03-20T10:10:00Z', [change('74-20007-物品数量', '50', '30')]),
      ],
      generatedAt: new Date('2026-03-20T11:00:00Z'),
    });

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      key: '74-20007-物品数量',
      recoveryValue: '100',
      observedNewValue: '50',
      sourceTimestamp: '2026-03-20T10:05:00.000Z',
      evidenceStatus: 'proven',
    });
  });



  it('collects first changes for different fields across the whole post-target log, not just one frame', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:05:00Z', [change('74-20007-物品数量', '100', '50')]),
        tp('2026-03-20T10:10:00Z', [change('74-20008-物品数量', '10', '5')]),
        tp('2026-03-20T10:15:00Z', [change('74-20007-绑定状态', '0', '1')]),
      ],
    });

    expect(result.fields.map((field) => field.key)).toEqual([
      '74-20007-物品数量',
      '74-20007-绑定状态',
      '74-20008-物品数量',
    ]);
  });

  it('respects an inclusive end time window', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      targetEndTime: new Date('2026-03-20T10:07:00Z'),
      timePoints: [
        tp('2026-03-20T10:10:00Z', [change('74-20007-物品数量', '50', '30')]),
      ],
    });

    expect(result.fields).toEqual([]);
  });

  it('groups changed fields into provable slot fragments by slot prefix', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [
        tp('2026-03-20T10:05:00Z', [
          change('74-20007-物品数量', '100', '50'),
          change('74-20007-绑定状态', '0', '1'),
          change('74-20008-物品数量', '10', '5'),
        ]),
      ],
    });

    expect(result.fragments.map((fragment) => fragment.slotPrefix)).toEqual(['74-20007', '74-20008']);
    expect(result.fragments[0].fields.map((field) => field.key).sort()).toEqual(['74-20007-物品数量', '74-20007-绑定状态'].sort());
    expect(result.fragments[0]).toMatchObject({
      groupingStrategy: 'heuristic-all-but-last-key-part',
      groupingConfidence: 'heuristic',
    });
  });

  it('falls back deterministically for short keys', () => {
    expect(getSlotPrefix(['100'], '100')).toBe('100');
    expect(getSlotPrefix(['244', '1'], '244-1')).toBe('244');
  });

  it('does not emit missing fields when no explicit expected schema is supplied', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [change('74-20007-物品数量', '100', '50')])],
    });

    expect(result.expectedSchemaSource).toBe('none');
    expect(result.fields.map((field) => field.key)).not.toContain('74-20007-强化等级');
  });

  it('marks explicit expected fields as evidence-insufficient when absent from logs', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [change('74-20007-物品数量', '100', '50')])],
      expectedFields: [{ key: '74-20007-强化等级' }],
    });

    expect(result.expectedSchemaSource).toBe('explicit');
    expect(result.fields.find((field) => field.key === '74-20007-强化等级')).toMatchObject({
      recoveryValue: null,
      observedNewValue: null,
      evidenceStatus: 'evidence-insufficient',
      source: 'expected-field',
    });
  });

  it('uses filename identity when no aid is available', () => {
    expect(resolveRecoveryIdentity({ fileName: 'player_abc.csv' })).toEqual({
      playerLabel: 'player_abc.csv',
      playerId: null,
      playerIdentifierSource: 'filename',
    });
  });

  it('prefers valid aid from log metadata over filename', () => {
    expect(resolveRecoveryIdentity({ fileName: 'player_abc.csv', aid: ' 30344223 ' })).toEqual({
      playerLabel: '30344223',
      playerId: '30344223',
      playerIdentifierSource: 'aid-from-log',
    });
  });

  it('keeps delete and create semantics under the first-oldValue rule', () => {
    const result = inferRecoveryFragments({
      identity,
      targetStartTime: new Date('2026-03-20T10:00:00Z'),
      timePoints: [tp('2026-03-20T10:05:00Z', [change('74-20007-物品数量', 'nil', '50'), change('74-20008-物品数量', '10', 'nil')])],
    });

    expect(result.fields.find((field) => field.key === '74-20007-物品数量')).toMatchObject({
      recoveryValue: 'nil',
      changeType: 'create',
    });
    expect(result.fields.find((field) => field.key === '74-20008-物品数量')).toMatchObject({
      recoveryValue: '10',
      changeType: 'delete',
    });
  });
});
