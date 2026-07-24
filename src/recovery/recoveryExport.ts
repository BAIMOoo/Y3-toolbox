import type { RecoveryFieldEntry, RecoveryInferenceResult } from './recoveryInference';
import { compareOrdinalStrings } from './recoveryOrdering';
import { isJsonContainer, parseRecoveryValue, type ParsedRecoveryValue } from './recoveryValue';

type ArchiveDataType = 0 | 1 | 2 | 3 | 4;

interface ArchiveJsonSlot {
  data_value: unknown;
  day_value: number;
  data_type: ArchiveDataType;
}

type ArchiveJsonExport = Record<string, ArchiveJsonSlot>;
type MutableJsonObject = Record<string, unknown>;
type MutableJsonContainer = MutableJsonObject | unknown[];

export function serializeRecoveryJson(result: RecoveryInferenceResult): string {
  return `${JSON.stringify(buildRecoveryArchiveJson(result), null, 2)}\n`;
}

export function buildRecoveryArchiveJson(result: RecoveryInferenceResult): ArchiveJsonExport {
  const fieldsBySlot = groupExportFields(result.fields);
  const archive: ArchiveJsonExport = Object.create(null) as ArchiveJsonExport;

  for (const slotId of [...fieldsBySlot.keys()].sort(slotSortCompare)) {
    const fields = fieldsBySlot.get(slotId) ?? [];
    const dataValue = assembleSlotValue(fields);
    if (dataValue === undefined) continue;

    defineJsonProperty(archive, slotId, {
      data_value: sortJsonValue(dataValue),
      day_value: resolveDayValue(fields),
      data_type: inferDataType(fields, dataValue),
    });
  }

  return archive;
}

export function buildRecoveryExportBaseName(fileName: string): string {
  return fileName
    .replace(/\.csv$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '') || 'archive_recovery';
}

function groupExportFields(fields: RecoveryFieldEntry[]): Map<string, RecoveryFieldEntry[]> {
  const groups = new Map<string, RecoveryFieldEntry[]>();
  for (const field of fields) {
    if (field.evidenceStatus !== 'proven' || field.recoveryValue === null) continue;
    const rootSlotId = field.key.split('-').filter(Boolean)[0];
    if (!rootSlotId) continue;
    const group = groups.get(rootSlotId) ?? [];
    group.push(field);
    groups.set(rootSlotId, group);
  }
  return groups;
}

function assembleSlotValue(fields: RecoveryFieldEntry[]): unknown | undefined {
  const explicitContainers = new WeakSet<object>();
  let root: unknown | undefined;

  for (const field of [...fields].sort(compareEvidenceDescending)) {
    const [, ...nestedPath] = field.key.split('-').filter(Boolean);
    const parsed = parseRecoveryValue(field.recoveryValue);
    const value = parsed.kind === 'absent'
      ? undefined
      : parsed.kind === 'parsed'
        ? nestedPath.length === 0 && !isJsonContainer(parsed.value)
          ? field.recoveryValue
          : cloneJsonValue(parsed.value, explicitContainers)
        : parsed.value;

    if (nestedPath.length === 0) {
      root = value;
    } else {
      root = applyNestedValue(root, nestedPath, value, explicitContainers);
    }
  }

  return root;
}

function applyNestedValue(
  currentRoot: unknown,
  path: string[],
  value: unknown | undefined,
  explicitContainers: WeakSet<object>,
): unknown | undefined {
  let root: MutableJsonContainer | undefined = isJsonContainer(currentRoot) ? currentRoot : createJsonObject();
  if (Array.isArray(root) && shouldConvertArray(root, path[0], path.length === 1 && value === undefined)) {
    root = convertArrayToObject(root, explicitContainers);
  }
  const parents: Array<{ container: MutableJsonContainer; key: string }> = [];
  let cursor: MutableJsonContainer = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const next = readJsonProperty(cursor, key);
    if (isJsonContainer(next)) {
      let nextContainer: MutableJsonContainer = next;
      const nextPathKey = path[index + 1];
      const deletesNextLeaf = index + 1 === path.length - 1 && value === undefined;
      if (Array.isArray(next) && shouldConvertArray(next, nextPathKey, deletesNextLeaf)) {
        nextContainer = convertArrayToObject(next, explicitContainers);
        defineJsonProperty(cursor, key, nextContainer);
      }
      parents.push({ container: cursor, key });
      cursor = nextContainer;
    } else {
      const child = createJsonObject();
      defineJsonProperty(cursor, key, child);
      parents.push({ container: cursor, key });
      cursor = child;
    }
  }

  const leafKey = path[path.length - 1];
  if (value === undefined) {
    deleteJsonProperty(cursor, leafKey);
    for (let index = parents.length - 1; index >= 0; index -= 1) {
      const { container, key } = parents[index];
      const child = readJsonProperty(container, key);
      if (!isJsonContainer(child) || !isEmptyContainer(child) || explicitContainers.has(child)) break;
      deleteJsonProperty(container, key);
    }
    if (isEmptyContainer(root) && !explicitContainers.has(root)) root = undefined;
  } else {
    defineJsonProperty(cursor, leafKey, value);
  }

  return root;
}

function inferDataType(fields: RecoveryFieldEntry[], dataValue: unknown): ArchiveDataType {
  if (isJsonContainer(dataValue) || fields.some((field) => field.key.split('-').filter(Boolean).length > 1)) return 4;
  const raw = String(dataValue).trim();
  if (/^(true|false)$/i.test(raw)) return 1;
  if (/^[+-]?\d+$/.test(raw)) return 2;
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(raw) || /^Fix32\([^()]+\)$/.test(raw)) return 3;
  return 0;
}

function resolveDayValue(fields: RecoveryFieldEntry[]): number {
  const first = [...fields].sort(compareEvidenceAscending)[0];
  if (!first?.dayValueOld) return 0;
  const parsed = Number(first.dayValueOld);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function compareEvidenceAscending(left: RecoveryFieldEntry, right: RecoveryFieldEntry): number {
  return compareTimestamps(left.sourceTimestamp, right.sourceTimestamp)
    || (left.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (right.sourceOrder ?? Number.MAX_SAFE_INTEGER)
    || compareOrdinalStrings(left.key, right.key);
}

function compareEvidenceDescending(left: RecoveryFieldEntry, right: RecoveryFieldEntry): number {
  return compareEvidenceAscending(right, left);
}

function compareTimestamps(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
  return normalizedLeft - normalizedRight;
}

function cloneJsonValue(value: unknown, explicitContainers: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => readJsonProperty(value, key) === undefined)) {
      return convertArrayToObject(value, explicitContainers, true);
    }
    const clone = value.map((entry) => cloneJsonValue(entry, explicitContainers));
    explicitContainers.add(clone);
    return clone;
  }
  if (!isJsonContainer(value)) return value;

  const clone = createJsonObject();
  explicitContainers.add(clone);
  for (const key of Object.keys(value)) {
    const child = readJsonProperty(value, key);
    if (child !== undefined) defineJsonProperty(clone, key, cloneJsonValue(child, explicitContainers));
  }
  return clone;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isJsonContainer(value)) return value;

  const sorted = createJsonObject();
  for (const key of Object.keys(value).sort(slotSortCompare)) {
    defineJsonProperty(sorted, key, sortJsonValue(readJsonProperty(value, key)));
  }
  return sorted;
}

function createJsonObject(): MutableJsonObject {
  return Object.create(null) as MutableJsonObject;
}

function shouldConvertArray(array: unknown[], key: string, deletesLeaf: boolean): boolean {
  return deletesLeaf || !isArrayIndexKey(key) || !Object.prototype.hasOwnProperty.call(array, key);
}

function isArrayIndexKey(key: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index <= 0xffff_fffe;
}

function convertArrayToObject(
  array: unknown[],
  explicitContainers: WeakSet<object>,
  omitUndefined = false,
): MutableJsonObject {
  const object = createJsonObject();
  explicitContainers.add(object);
  for (const key of Object.keys(array)) {
    const value = readJsonProperty(array, key);
    if (omitUndefined && value === undefined) continue;
    defineJsonProperty(object, key, omitUndefined ? cloneJsonValue(value, explicitContainers) : value);
  }
  return object;
}

function defineJsonProperty(container: MutableJsonContainer, key: string, value: unknown): void {
  Object.defineProperty(container, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function readJsonProperty(container: MutableJsonContainer, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(container, key) ? container[key as keyof typeof container] : undefined;
}

function deleteJsonProperty(container: MutableJsonContainer, key: string): void {
  Reflect.deleteProperty(container, key);
}

function isEmptyContainer(value: ParsedRecoveryValue): boolean {
  return Object.keys(value).length === 0;
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
