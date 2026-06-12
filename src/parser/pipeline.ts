import type { RawLogRow, TimePoint, ArchiveChange } from '../types';
import { extractArchiveDiff, parseArchiveDiff } from './archiveDiffParser';

export function buildTimePoints(rows: RawLogRow[]): TimePoint[] {
  const groupMap = new Map<string, ArchiveChange[]>();
  for (const row of rows) {
    // csvParser now always outputs clean diff strings in rawText,
    // but for backward compatibility also support raw syslog lines.
    const diffStr = row.isClean
      ? row.rawText
      : extractArchiveDiff(row.rawText);
    if (!diffStr) continue;
    const changes = parseArchiveDiff(diffStr);
    if (changes.length === 0) continue;
    const existing = groupMap.get(row.timestamp);
    if (existing) { existing.push(...changes); }
    else { groupMap.set(row.timestamp, [...changes]); }
  }
  const timePoints: TimePoint[] = Array.from(groupMap.entries())
    .map(([ts, changes]) => ({ index: 0, timestamp: new Date(ts), changes }))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  timePoints.forEach((tp, i) => { tp.index = i; });
  return timePoints;
}

export function extractRootKeys(timePoints: TimePoint[]): string[] {
  const keys = new Set<string>();
  for (const tp of timePoints) {
    for (const change of tp.changes) { keys.add(change.rootKey); }
  }
  return Array.from(keys).sort();
}
