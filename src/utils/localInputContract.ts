export const DIFF_CSV_EXTENSION = '.csv';
export const ARCHIVE_JSON_EXTENSION = '.json';

export function isCsvPath(filePath: string): boolean {
  return hasExtension(filePath, DIFF_CSV_EXTENSION);
}

export function isJsonPath(filePath: string): boolean {
  return hasExtension(filePath, ARCHIVE_JSON_EXTENSION);
}

function hasExtension(filePath: string, extension: string): boolean {
  return filePath.toLowerCase().endsWith(extension);
}
