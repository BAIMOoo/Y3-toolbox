import type { TimePoint, Snapshot, SnapshotValue } from '../types';

function deepClone(obj: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(obj));
}

function setNestedValue(snapshot: Snapshot, keyParts: string[], value: string): void {
  let current: Record<string, SnapshotValue> = snapshot;
  for (let i = 0; i < keyParts.length - 1; i++) {
    const part = keyParts[i];
    const child = current[part];
    if (child === undefined || typeof child !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, SnapshotValue>;
  }
  const lastKey = keyParts[keyParts.length - 1];
  if (value === '{}') {
    if (current[lastKey] === undefined) { current[lastKey] = {}; }
  } else {
    current[lastKey] = value;
  }
}

function deleteNestedValue(snapshot: Snapshot, keyParts: string[]): void {
  let current: Record<string, SnapshotValue> = snapshot;
  for (let i = 0; i < keyParts.length - 1; i++) {
    const part = keyParts[i];
    const child = current[part];
    if (child === undefined || typeof child !== 'object') { return; }
    current = child as Record<string, SnapshotValue>;
  }
  delete current[keyParts[keyParts.length - 1]];
}

function applyChanges(snapshot: Snapshot, timePoint: TimePoint): void {
  for (const change of timePoint.changes) {
    if (change.newValue === 'nil') {
      deleteNestedValue(snapshot, change.keyParts);
    } else {
      setNestedValue(snapshot, change.keyParts, change.newValue);
    }
  }
}

/**
 * SnapshotEngine — lazily computes snapshots on demand instead of
 * precomputing all of them. Caches the most recently accessed snapshot
 * and its index so sequential navigation (prev/next) is fast.
 */
export class SnapshotEngine {
  private timePoints: TimePoint[];
  private cachedIndex: number = -1;
  private cachedSnapshot: Snapshot = {};

  constructor(timePoints: TimePoint[]) {
    this.timePoints = timePoints;
  }

  /**
   * Get the snapshot at a given time point index.
   * Builds it by applying changes from T0..Tindex.
   * Uses cache: if requesting index near cachedIndex, builds incrementally.
   */
  getSnapshotAt(index: number): Snapshot {
    if (index < 0 || this.timePoints.length === 0) return {};
    if (index >= this.timePoints.length) index = this.timePoints.length - 1;

    // Cache hit
    if (index === this.cachedIndex) {
      return deepClone(this.cachedSnapshot);
    }

    let snapshot: Snapshot;
    let startFrom: number;

    if (this.cachedIndex >= 0 && index > this.cachedIndex) {
      // Build forward from cache
      snapshot = deepClone(this.cachedSnapshot);
      startFrom = this.cachedIndex + 1;
    } else {
      // Build from scratch
      snapshot = {};
      startFrom = 0;
    }

    for (let i = startFrom; i <= index; i++) {
      applyChanges(snapshot, this.timePoints[i]);
    }

    // Update cache
    this.cachedIndex = index;
    this.cachedSnapshot = deepClone(snapshot);

    return snapshot;
  }

  get length(): number {
    return this.timePoints.length;
  }
}
