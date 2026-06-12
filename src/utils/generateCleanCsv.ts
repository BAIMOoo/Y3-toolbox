import Papa from 'papaparse';
import type { RawLogRow } from '../types';

/**
 * Generate a clean CSV string from parsed RawLogRow[].
 *
 * Output format matches the cleaned archive_diff CSV contract:
 * - Columns: "日志时间", "archive_diff"
 * - All fields quoted
 * - UTF-8, no BOM
 * - Trailing newline (\r\n, RFC 4180)
 */
export function generateCleanCsv(rows: RawLogRow[]): string {
  const csvData = rows.map(row => ({
    '日志时间': row.timestamp,
    'archive_diff': row.rawText,
  }));
  return Papa.unparse(csvData, { quotes: true, columns: ['日志时间', 'archive_diff'] }) + '\r\n';
}
