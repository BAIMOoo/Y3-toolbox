import type { RawLogRow } from '../types';

export type RecoveryAidDetectionStatus = 'none' | 'single' | 'multiple';

export interface RecoveryAidDetection {
  status: RecoveryAidDetectionStatus;
  aid: string | null;
  distinctAids: string[];
}

/**
 * Browser-safe aid detection for recovery provenance.
 *
 * Clean archive_diff CSVs may not include player metadata; those remain valid
 * and fall back to filename identity. When exactly one valid aid is present, it
 * takes precedence over filename labels. Mixed-aid inputs are rejected by the UI
 * because V1 recovery inference has no row-level player partitioning.
 */
export function detectRecoveryAid(rows: RawLogRow[]): RecoveryAidDetection {
  const aids: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const aid of getAidCandidates(row)) {
      if (seen.has(aid)) continue;
      seen.add(aid);
      aids.push(aid);
    }
  }

  if (aids.length === 0) return { status: 'none', aid: null, distinctAids: [] };
  if (aids.length === 1) return { status: 'single', aid: aids[0], distinctAids: aids };
  return { status: 'multiple', aid: null, distinctAids: aids };
}

export function extractRecoveryAid(rows: RawLogRow[]): string | null {
  return detectRecoveryAid(rows).aid;
}

function getAidCandidates(row: RawLogRow): string[] {
  const candidates = [
    normalizeAid(row.aid),
    extractAidFromText(row.originalText),
    extractAidFromText(row.rawText),
  ].filter((aid): aid is string => aid !== null);
  return [...new Set(candidates)];
}

export function extractAidFromText(text: string | undefined): string | null {
  if (!text) return null;

  const jsonAid = extractAidFromJson(text);
  if (jsonAid) return jsonAid;

  const match = text.match(/"aid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  if (!match) return null;

  try {
    return normalizeAid(JSON.parse(`"${match[1]}"`));
  } catch {
    return normalizeAid(match[1]);
  }
}

function extractAidFromJson(text: string): string | null {
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) return null;

  try {
    const data = JSON.parse(text.slice(jsonStart));
    return normalizeAid((data as { aid?: unknown }).aid);
  } catch {
    return null;
  }
}

function normalizeAid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
