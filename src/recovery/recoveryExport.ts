import type { RecoveryFieldEntry, RecoveryInferenceResult } from './recoveryInference';
import { compareOrdinalStrings } from './recoveryOrdering';

interface ArchiveJsonTypedValue<T> {
  type: string;
  value: T;
}

interface ArchiveJsonSlot {
  day_value: ArchiveJsonTypedValue<number>;
  data_value: ArchiveJsonTypedValue<unknown>;
  data_type: ArchiveJsonTypedValue<number>;
}

type ArchiveJsonExport = Record<string, ArchiveJsonSlot>;
type MutableJsonObject = Record<string, unknown>;

export function serializeRecoveryJson(result: RecoveryInferenceResult): string {
  return `${JSON.stringify(buildRecoveryArchiveJson(result), null, 2)}\n`;
}

export function buildRecoveryArchiveJson(result: RecoveryInferenceResult): ArchiveJsonExport {
  const archive: ArchiveJsonExport = {};
  const fields = [...result.fields]
    .filter((field) => field.evidenceStatus === 'proven' && field.recoveryValue !== null)
    .sort(compareExportFields);

  for (const field of fields) {
    const keyParts = field.key.split('-').filter(Boolean);
    if (keyParts.length === 0) continue;

    const [rootSlotId, ...nestedPath] = keyParts;
    const slot = archive[rootSlotId] ?? createArchiveJsonSlot();
    archive[rootSlotId] = slot;

    slot.data_value.value = setRecoveryValueAtPath(slot.data_value.value, nestedPath, field.recoveryValue ?? '');
  }

  return sortArchiveJsonSlots(archive);
}

export function buildRecoveryExportBaseName(fileName: string): string {
  return fileName
    .replace(/\.csv$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '') || 'archive_recovery';
}

function createArchiveJsonSlot(): ArchiveJsonSlot {
  return {
    day_value: { type: 'int', value: 0 },
    data_value: { type: 'str', value: {} },
    data_type: { type: 'int', value: 4 },
  };
}

function setRecoveryValueAtPath(currentValue: unknown, nestedPath: string[], recoveryValue: string): unknown {
  if (nestedPath.length === 0) return recoveryValue;

  const root = isMutableJsonObject(currentValue) ? currentValue : {};
  let cursor: MutableJsonObject = root;

  for (let index = 0; index < nestedPath.length - 1; index += 1) {
    const part = nestedPath[index];
    const next = cursor[part];
    if (isMutableJsonObject(next)) {
      cursor = next;
    } else {
      const child: MutableJsonObject = {};
      cursor[part] = child;
      cursor = child;
    }
  }

  cursor[nestedPath[nestedPath.length - 1]] = recoveryValue;
  return root;
}

function sortArchiveJsonSlots(archive: ArchiveJsonExport): ArchiveJsonExport {
  const sorted: ArchiveJsonExport = {};
  for (const slotId of Object.keys(archive).sort(slotSortCompare)) {
    sorted[slotId] = {
      ...archive[slotId],
      data_value: {
        ...archive[slotId].data_value,
        value: sortJsonValue(archive[slotId].data_value.value),
      },
    };
  }
  return sorted;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isMutableJsonObject(value)) return value;

  const sorted: MutableJsonObject = {};
  for (const key of Object.keys(value).sort(slotSortCompare)) {
    sorted[key] = sortJsonValue(value[key]);
  }
  return sorted;
}

function isMutableJsonObject(value: unknown): value is MutableJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareExportFields(a: RecoveryFieldEntry, b: RecoveryFieldEntry): number {
  return compareOrdinalStrings(a.slotPrefix, b.slotPrefix)
    || compareOrdinalStrings(a.key, b.key)
    || compareOrdinalStrings(String(a.sourceTimestamp ?? ''), String(b.sourceTimestamp ?? ''));
}

function slotSortCompare(left: string, right: string): number {
  const leftNumber = numericSlotId(left);
  const rightNumber = numericSlotId(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return compareOrdinalStrings(left, right);
}

function numericSlotId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
