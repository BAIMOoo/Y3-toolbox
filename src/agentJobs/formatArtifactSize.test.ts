import { describe, expect, it } from 'vitest';
import { formatArtifactSize } from './formatArtifactSize';

describe('formatArtifactSize', () => {
  it('formats artifact sizes as KB or MB instead of raw bytes', () => {
    expect(formatArtifactSize(42173914)).toBe('40.2 MB');
    expect(formatArtifactSize(750768)).toBe('733 KB');
    expect(formatArtifactSize(0)).toBe('0.00 KB');
  });
});
