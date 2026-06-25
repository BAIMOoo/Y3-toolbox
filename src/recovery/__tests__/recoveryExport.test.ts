import { describe, expect, it } from 'vitest';
import { inferRecoveryFragments } from '../recoveryInference';
import { buildRecoveryExportBaseName, escapeCsvValue, serializeRecoveryCsv, serializeRecoveryJson } from '../recoveryExport';
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
      ]),
    ],
    expectedFields: [{ key: '74-20007-强化等级' }],
  });
}

describe('recovery export serializers', () => {
  it('escapes CSV values using RFC-style double quotes', () => {
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('a "quote"')).toBe('"a ""quote"""');
    expect(escapeCsvValue('a\nb')).toBe('"a\nb"');
  });

  it('serializes reviewable CSV with provenance and safety fields', () => {
    const csv = serializeRecoveryCsv(sampleResult());

    expect(csv.split('\n')[0]).toContain('playerIdentifierSource');
    expect(csv).toContain('30344223');
    expect(csv).toContain('aid-from-log');
    expect(csv).toContain('heuristic-all-but-last-key-part');
    expect(csv).toContain('explicit');
    expect(csv).toContain('evidence-insufficient');
    expect(csv).toContain('false');
    expect(csv).toContain('"100, ""quoted""\nline"');
  });

  it('serializes versioned JSON schema with provenance and no-write-back marker', () => {
    const parsed = JSON.parse(serializeRecoveryJson(sampleResult()));

    expect(parsed.version).toBe(1);
    expect(parsed.writeBackSupported).toBe(false);
    expect(parsed.identity).toMatchObject({
      playerId: '30344223',
      playerIdentifierSource: 'aid-from-log',
    });
    expect(parsed.expectedSchemaSource).toBe('explicit');
    expect(parsed.fragments[0]).toMatchObject({
      slotPrefix: '74-20007',
      groupingStrategy: 'heuristic-all-but-last-key-part',
      groupingConfidence: 'heuristic',
    });
    expect(parsed.fields.some((field: { evidenceStatus: string }) => field.evidenceStatus === 'evidence-insufficient')).toBe(true);
  });

  it('keeps export ordering stable by slot prefix and key', () => {
    const first = serializeRecoveryJson(sampleResult());
    const second = serializeRecoveryJson(sampleResult());
    expect(second).toBe(first);
  });

  it('builds safe export base names', () => {
    expect(buildRecoveryExportBaseName('player abc.csv')).toBe('player_abc');
    expect(buildRecoveryExportBaseName('')).toBe('archive_recovery');
  });
});
