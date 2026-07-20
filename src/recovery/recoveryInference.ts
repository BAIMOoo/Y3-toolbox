import type { ArchiveChange, ChangeType, TimePoint } from '../types';
import { compareOrdinalStrings } from './recoveryOrdering';

export type PlayerIdentifierSource = 'aid-from-log' | 'filename';
export type ExpectedSchemaSource = 'none' | 'explicit';
export type EvidenceStatus = 'proven' | 'evidence-insufficient';
export type GroupingStrategy = 'heuristic-all-but-last-key-part' | 'root-or-full-key-fallback';
export type GroupingConfidence = 'heuristic';

export interface RecoveryIdentityInput {
  fileName: string;
  aid?: string | null;
}

export interface RecoveryIdentity {
  playerLabel: string;
  playerId: string | null;
  playerIdentifierSource: PlayerIdentifierSource;
}

export interface ExpectedFieldDefinition {
  key: string;
  label?: string;
}

export interface RecoveryInferenceOptions {
  timePoints: TimePoint[];
  /**
   * Set only when the caller already guarantees ascending timestamp order.
   * The default is intentionally defensive for direct callers with unsorted input.
   */
  assumeSortedTimePoints?: boolean;
  targetStartTime: Date;
  targetEndTime?: Date | null;
  identity: RecoveryIdentityInput;
  expectedFields?: ExpectedFieldDefinition[];
  generatedAt?: Date;
}

export interface RecoveryFieldEntry {
  key: string;
  fieldLabel: string;
  slotPrefix: string;
  recoveryValue: string | null;
  observedNewValue: string | null;
  sourceTimestamp: string | null;
  changeType: ChangeType | null;
  evidenceStatus: EvidenceStatus;
  source: 'archive_diff' | 'expected-field';
}

export interface RecoverySlotFragment {
  slotPrefix: string;
  groupingStrategy: GroupingStrategy;
  groupingConfidence: GroupingConfidence;
  fields: RecoveryFieldEntry[];
}

export interface RecoveryInferenceResult {
  version: 1;
  generatedAt: string;
  target: {
    startTime: string;
    endTime: string | null;
  };
  identity: RecoveryIdentity;
  expectedSchemaSource: ExpectedSchemaSource;
  writeBackSupported: false;
  fragments: RecoverySlotFragment[];
  fields: RecoveryFieldEntry[];
}

export function inferRecoveryFragments(options: RecoveryInferenceOptions): RecoveryInferenceResult {
  const identity = resolveRecoveryIdentity(options.identity);
  const startMs = options.targetStartTime.getTime();
  const endMs = options.targetEndTime?.getTime() ?? null;
  const firstChanges = new Map<string, { change: ArchiveChange; timestamp: Date }>();

  const orderedTimePoints = options.assumeSortedTimePoints
    ? options.timePoints
    : [...options.timePoints].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  for (const timePoint of orderedTimePoints) {
    const timeMs = timePoint.timestamp.getTime();
    if (!Number.isFinite(timeMs) || timeMs < startMs) continue;
    if (endMs !== null && timeMs > endMs) continue;

    for (const change of timePoint.changes) {
      if (!firstChanges.has(change.key)) {
        firstChanges.set(change.key, { change, timestamp: timePoint.timestamp });
      }
    }
  }

  const fields: RecoveryFieldEntry[] = [];
  for (const { change, timestamp } of firstChanges.values()) {
    const slotPrefix = getSlotPrefix(change.keyParts, change.key);
    fields.push({
      key: change.key,
      fieldLabel: getFieldLabel(change.keyParts, change.key),
      slotPrefix,
      recoveryValue: change.oldValue,
      observedNewValue: change.newValue,
      sourceTimestamp: timestamp.toISOString(),
      changeType: change.changeType,
      evidenceStatus: 'proven',
      source: 'archive_diff',
    });
  }

  const expectedFields = options.expectedFields ?? [];
  const expectedSchemaSource: ExpectedSchemaSource = expectedFields.length > 0 ? 'explicit' : 'none';
  for (const expected of expectedFields) {
    if (firstChanges.has(expected.key)) continue;
    const keyParts = expected.key.split('-');
    const slotPrefix = getSlotPrefix(keyParts, expected.key);
    fields.push({
      key: expected.key,
      fieldLabel: expected.label ?? getFieldLabel(keyParts, expected.key),
      slotPrefix,
      recoveryValue: null,
      observedNewValue: null,
      sourceTimestamp: null,
      changeType: null,
      evidenceStatus: 'evidence-insufficient',
      source: 'expected-field',
    });
  }

  fields.sort(compareFields);

  const fragmentMap = new Map<string, RecoverySlotFragment>();
  for (const field of fields) {
    const keyParts = field.key.split('-');
    const strategy = getGroupingStrategy(keyParts);
    let fragment = fragmentMap.get(field.slotPrefix);
    if (!fragment) {
      fragment = {
        slotPrefix: field.slotPrefix,
        groupingStrategy: strategy,
        groupingConfidence: 'heuristic',
        fields: [],
      };
      fragmentMap.set(field.slotPrefix, fragment);
    }
    fragment.fields.push(field);
  }

  const fragments = [...fragmentMap.values()].sort((a, b) => compareOrdinalStrings(a.slotPrefix, b.slotPrefix));

  return {
    version: 1,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    target: {
      startTime: options.targetStartTime.toISOString(),
      endTime: options.targetEndTime ? options.targetEndTime.toISOString() : null,
    },
    identity,
    expectedSchemaSource,
    writeBackSupported: false,
    fragments,
    fields,
  };
}

export function resolveRecoveryIdentity(input: RecoveryIdentityInput): RecoveryIdentity {
  const aid = typeof input.aid === 'string' ? input.aid.trim() : '';
  if (aid) {
    return {
      playerLabel: aid,
      playerId: aid,
      playerIdentifierSource: 'aid-from-log',
    };
  }
  return {
    playerLabel: input.fileName,
    playerId: null,
    playerIdentifierSource: 'filename',
  };
}

export function getSlotPrefix(keyParts: string[], fallbackKey: string): string {
  if (keyParts.length >= 3) return keyParts.slice(0, -1).join('-');
  if (keyParts.length === 2) return keyParts[0];
  return fallbackKey;
}

export function getFieldLabel(keyParts: string[], fallbackKey: string): string {
  return keyParts.length >= 2 ? keyParts[keyParts.length - 1] : fallbackKey;
}

function getGroupingStrategy(keyParts: string[]): GroupingStrategy {
  return keyParts.length >= 3 ? 'heuristic-all-but-last-key-part' : 'root-or-full-key-fallback';
}

function compareFields(a: RecoveryFieldEntry, b: RecoveryFieldEntry): number {
  return compareOrdinalStrings(a.slotPrefix, b.slotPrefix)
    || compareOrdinalStrings(a.key, b.key)
    || compareOrdinalStrings(String(a.sourceTimestamp ?? ''), String(b.sourceTimestamp ?? ''));
}
