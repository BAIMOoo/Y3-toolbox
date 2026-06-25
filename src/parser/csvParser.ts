import Papa from 'papaparse';
import type { RawLogRow } from '../types';

/**
 * Detect CSV format and parse into RawLogRow[].
 *
 * Supports raw archive_diff CSV, cleaned archive_diff CSV, and batch-check exports
 * with matched_log_raw. Header matching is intentionally tolerant because CSVs
 * may come from different tools/locales.
 */
export function parseCsvText(csvText: string): RawLogRow[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const fields = (result.meta.fields ?? []).map((field) => field.trim());
  const archiveDiffField = findField(fields, ['archive_diff']);
  const aidField = findField(fields, ['aid']);
  const rawLogField = findField(fields, ['matched_log_raw']) ?? findRawLogField(fields, result.data);
  const timestampField = archiveDiffField
    ? findArchiveDiffTimestampField(fields, archiveDiffField, rawLogField)
    : findTimestampField(fields, archiveDiffField, rawLogField);
  const fallbackTimestampField = findField(fields, ['query_to', 'end_time']);

  if (archiveDiffField) {
    if (!timestampField) return [];
    return result.data
      .filter((row) => row[timestampField] && row[archiveDiffField])
      .map((row) => ({
        timestamp: normalizeTimestamp(row[timestampField]),
        aid: normalizeOptionalString(aidField ? row[aidField] : undefined),
        rawText: row[archiveDiffField].trim(),
        isClean: true,
        originalText: normalizeOptionalString(rawLogField ? row[rawLogField] : undefined),
      }));
  }

  if (!rawLogField) return [];

  const rows: RawLogRow[] = [];
  for (const row of result.data) {
    const rawLog = row[rawLogField]?.trim();
    if (!rawLog?.includes('[MapArchiveUpload]')) continue;
    const diff = extractDiffFromJson(rawLog);
    if (!diff) continue;
    const timestamp = getRowTimestamp(row, timestampField, fallbackTimestampField, rawLog);
    if (!timestamp) continue;
    rows.push({
      timestamp,
      aid: extractAidFromRawLog(rawLog),
      rawText: diff,
      isClean: true,
      originalText: rawLog,
    });
  }
  return rows;
}


function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function extractAidFromRawLog(rawLog: string): string | undefined {
  try {
    const jsonStart = rawLog.indexOf('{');
    if (jsonStart === -1) return undefined;
    const data = JSON.parse(rawLog.slice(jsonStart));
    const aid = data?.aid;
    return typeof aid === 'string' && aid.trim() ? aid.trim() : undefined;
  } catch {
    const match = rawLog.match(/"aid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (!match) return undefined;
    try {
      const parsed = JSON.parse(`"${match[1]}"`);
      return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : undefined;
    } catch {
      return match[1].trim() || undefined;
    }
  }
}

function findField(fields: string[], candidates: string[]): string | null {
  const lowerFields = new Map(fields.map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const exact = lowerFields.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  return null;
}

function findRawLogField(fields: string[], rows: Record<string, string>[]): string | null {
  return fields.find((field) =>
    rows.some((row) => {
      const value = row[field];
      return value?.includes('[MapArchiveUpload]') || value?.includes('"archive_diff"');
    }),
  ) ?? null;
}

function findTimestampField(
  fields: string[],
  archiveDiffField: string | null,
  rawLogField: string | null,
): string | null {
  const explicit = findField(fields, [
    'query_from',
    'start_time',
    '\u65e5\u5fd7\u65f6\u95f4',
    '\u93c3\u30e5\u7e54\u93c3\u5815\u68ff',
  ]);
  if (explicit) return explicit;

  return fields.find((field) => field !== archiveDiffField && field !== rawLogField) ?? null;
}

function findArchiveDiffTimestampField(
  fields: string[],
  archiveDiffField: string | null,
  rawLogField: string | null,
): string | null {
  const explicit = findField(fields, [
    'log_time',
    'timestamp',
    '\u65e5\u5fd7\u65f6\u95f4',
    '\u93c3\u30e5\u7e54\u93c3\u5815\u68ff',
    'start_time',
    'query_from',
  ]);
  if (explicit) return explicit;

  return fields.find((field) => field !== archiveDiffField && field !== rawLogField) ?? null;
}

function getRowTimestamp(
  row: Record<string, string>,
  timestampField: string | null,
  fallbackTimestampField: string | null,
  rawLog: string,
): string | null {
  const fromField = timestampField ? row[timestampField]?.trim() : '';
  if (fromField) return normalizeTimestamp(fromField);
  const fallback = fallbackTimestampField ? row[fallbackTimestampField]?.trim() : '';
  if (fallback) return normalizeTimestamp(fallback);
  return extractTimestampFromRawLog(rawLog);
}

function normalizeTimestamp(value: string): string {
  return value.trim().replace(
    /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2}:\d{2}:\d{2})$/,
    '$1-$2-$3 $4',
  );
}

function extractTimestampFromRawLog(rawLog: string): string | null {
  const bracketed = rawLog.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) [+-]\d{4}\]/);
  if (bracketed) return bracketed[1];

  const syslog = rawLog.match(/^[A-Z][a-z]{2}\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/);
  if (!syslog) return null;
  const year = new Date().getFullYear();
  const month = rawLog.slice(0, 3);
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
  if (monthIndex === -1) return null;
  const day = syslog[1].padStart(2, '0');
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day} ${syslog[2]}`;
}

/**
 * Extract archive_diff value from a raw JSON log line.
 * Parses the JSON portion and returns the archive_diff field.
 */
function extractDiffFromJson(rawLog: string): string | null {
  try {
    const jsonStart = rawLog.indexOf('{');
    if (jsonStart === -1) return null;
    const jsonStr = rawLog.substring(jsonStart);
    const data = JSON.parse(jsonStr);
    return data.archive_diff ?? null;
  } catch {
    // Fallback: use string extraction if JSON parse fails
    const marker = '"archive_diff":"';
    const start = rawLog.indexOf(marker);
    if (start === -1) return null;
    const valueStart = start + marker.length;
    const valueEnd = rawLog.indexOf('"', valueStart);
    if (valueEnd === -1) return null;
    return rawLog.substring(valueStart, valueEnd);
  }
}

export async function parseCsvFile(file: File): Promise<RawLogRow[]> {
  const text = await file.text();
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return parseCsvText(clean);
}
