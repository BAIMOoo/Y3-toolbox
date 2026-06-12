import { describe, expect, it } from 'vitest';
import { shouldShowDiffContextToolbar } from './diffUiState';

describe('shouldShowDiffContextToolbar', () => {
  it('hides the diff toolbar before data is loaded', () => {
    expect(shouldShowDiffContextToolbar(false)).toBe(false);
  });

  it('shows the diff toolbar only after data is loaded', () => {
    expect(shouldShowDiffContextToolbar(true)).toBe(true);
  });
});
