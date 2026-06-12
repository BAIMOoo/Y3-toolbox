export function clampSplitRatio(ratio: number, minRatio: number, maxRatio: number): number {
  return Math.max(minRatio, Math.min(maxRatio, ratio));
}

export function nextKeyboardSplitRatio(
  currentRatio: number,
  key: string,
  minRatio: number,
  maxRatio: number,
  step = 0.05,
): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampSplitRatio(currentRatio - step, minRatio, maxRatio);
    case 'ArrowRight':
      return clampSplitRatio(currentRatio + step, minRatio, maxRatio);
    case 'Home':
      return minRatio;
    case 'End':
      return maxRatio;
    default:
      return null;
  }
}
