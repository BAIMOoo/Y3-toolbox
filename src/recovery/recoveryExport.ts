import type { RecoveryFieldEntry, RecoveryInferenceResult } from './recoveryInference';

const CSV_HEADERS = [
  'playerLabel',
  'playerId',
  'playerIdentifierSource',
  'slotPrefix',
  'fullKey',
  'fieldLabel',
  'recoveryValue',
  'observedNewValue',
  'sourceTimestamp',
  'changeType',
  'evidenceStatus',
  'groupingStrategy',
  'groupingConfidence',
  'expectedSchemaSource',
  'writeBackSupported',
];

export function serializeRecoveryCsv(result: RecoveryInferenceResult): string {
  const rows = [CSV_HEADERS.join(',')];
  for (const fragment of result.fragments) {
    const fields = [...fragment.fields].sort(compareExportFields);
    for (const field of fields) {
      rows.push([
        result.identity.playerLabel,
        result.identity.playerId ?? '',
        result.identity.playerIdentifierSource,
        fragment.slotPrefix,
        field.key,
        field.fieldLabel,
        field.recoveryValue ?? '',
        field.observedNewValue ?? '',
        field.sourceTimestamp ?? '',
        field.changeType ?? '',
        field.evidenceStatus,
        fragment.groupingStrategy,
        fragment.groupingConfidence,
        result.expectedSchemaSource,
        String(result.writeBackSupported),
      ].map(escapeCsvValue).join(','));
    }
  }
  return `${rows.join('\n')}\n`;
}

export function serializeRecoveryJson(result: RecoveryInferenceResult): string {
  return `${JSON.stringify(sortRecoveryResult(result), null, 2)}\n`;
}

export function buildRecoveryExportBaseName(fileName: string): string {
  return fileName
    .replace(/\.csv$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '') || 'archive_recovery';
}

export function escapeCsvValue(value: string): string {
  const escaped = value.replace(/"/g, '""');
  if (/[",\n\r]/.test(value)) return `"${escaped}"`;
  return escaped;
}

function sortRecoveryResult(result: RecoveryInferenceResult): RecoveryInferenceResult {
  const fragments = [...result.fragments]
    .sort((a, b) => a.slotPrefix.localeCompare(b.slotPrefix))
    .map((fragment) => ({
      ...fragment,
      fields: [...fragment.fields].sort(compareExportFields),
    }));
  return {
    ...result,
    fragments,
    fields: [...result.fields].sort(compareExportFields),
  };
}

function compareExportFields(a: RecoveryFieldEntry, b: RecoveryFieldEntry): number {
  return a.slotPrefix.localeCompare(b.slotPrefix)
    || a.key.localeCompare(b.key)
    || String(a.sourceTimestamp ?? '').localeCompare(String(b.sourceTimestamp ?? ''));
}
