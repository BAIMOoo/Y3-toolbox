import { describe, expect, it } from 'vitest';
import { ARCHIVE_JSON_EXTENSION, DIFF_CSV_EXTENSION, isCsvPath, isJsonPath } from '../localInputContract';

describe('localInputContract', () => {
  it('centralizes desktop input extensions for route and archive validation', () => {
    expect(DIFF_CSV_EXTENSION).toBe('.csv');
    expect(ARCHIVE_JSON_EXTENSION).toBe('.json');
    expect(isCsvPath('C:/tmp/LOG.CSV')).toBe(true);
    expect(isJsonPath('C:/tmp/archive_storage.JSON')).toBe(true);
    expect(isCsvPath('C:/tmp/archive_storage.json')).toBe(false);
    expect(isJsonPath('C:/tmp/log.csv')).toBe(false);
  });
});
