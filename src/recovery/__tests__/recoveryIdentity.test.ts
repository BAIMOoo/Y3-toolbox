import { describe, expect, it } from 'vitest';
import type { RawLogRow } from '../../types';
import { detectRecoveryAid, extractAidFromText, extractRecoveryAid } from '../recoveryIdentity';

describe('recovery identity extraction', () => {
  it('uses a parsed aid column when present', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2026-03-20 10:00:00', aid: ' 30344223 ', rawText: '|100=1>>>2', isClean: true },
    ];

    expect(extractRecoveryAid(rows)).toBe('30344223');
  });

  it('extracts aid from original raw log JSON without importing CLI recovery modules', () => {
    expect(extractAidFromText('prefix [MapArchiveUpload],{"aid":"30344224","archive_diff":"|100=1>>>2"}')).toBe('30344224');
  });

  it('falls back to null for clean CSVs without player metadata', () => {
    expect(extractRecoveryAid([
      { timestamp: '2026-03-20 10:00:00', rawText: '|100=1>>>2', isClean: true },
    ])).toBeNull();
  });



  it('treats disagreement between aid column and raw metadata as unsafe', () => {
    const rows: RawLogRow[] = [
      {
        timestamp: '2026-03-20 10:00:00',
        aid: '30344223',
        rawText: '|100=1>>>2',
        originalText: '{"aid":"30344223","archive_diff":"|100=1>>>2"}',
        isClean: true,
      },
      {
        timestamp: '2026-03-20 10:01:00',
        aid: '30344223',
        rawText: '|200=3>>>4',
        originalText: '{"aid":"30344224","archive_diff":"|200=3>>>4"}',
        isClean: true,
      },
    ];

    expect(detectRecoveryAid(rows)).toEqual({
      status: 'multiple',
      aid: null,
      distinctAids: ['30344223', '30344224'],
    });
  });

  it('marks mixed-aid inputs unsafe instead of choosing the first player', () => {
    const rows: RawLogRow[] = [
      { timestamp: '2026-03-20 10:00:00', aid: '30344223', rawText: '|100=1>>>2', isClean: true },
      { timestamp: '2026-03-20 10:01:00', aid: '30344224', rawText: '|200=3>>>4', isClean: true },
    ];

    expect(detectRecoveryAid(rows)).toEqual({
      status: 'multiple',
      aid: null,
      distinctAids: ['30344223', '30344224'],
    });
    expect(extractRecoveryAid(rows)).toBeNull();
  });
});
