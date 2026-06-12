export interface LocalArchiveSession {
  tabs: string[];
  current: number;
}

export function serializeArchiveSession(tabPaths: string[], currentIndex: number): string {
  const tabs = tabPaths.filter(Boolean);
  return JSON.stringify({ tabs, current: clampArchiveTabIndex(tabs.length, currentIndex) });
}

export function parseArchiveSession(raw: string | null): LocalArchiveSession {
  if (!raw) return { tabs: [], current: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<LocalArchiveSession>;
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter((path): path is string => typeof path === 'string' && path.length > 0) : [];
    return { tabs, current: clampArchiveTabIndex(tabs.length, Number(parsed.current ?? 0)) };
  } catch {
    return { tabs: [], current: 0 };
  }
}

export function clampArchiveTabIndex(tabCount: number, index: number): number {
  if (tabCount <= 0 || !Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), tabCount - 1));
}

export function nextIndexAfterClose(tabCount: number, currentIndex: number, closedIndex: number): number {
  const nextCount = Math.max(0, tabCount - 1);
  if (nextCount === 0) return 0;
  if (closedIndex < currentIndex) return clampArchiveTabIndex(nextCount, currentIndex - 1);
  return clampArchiveTabIndex(nextCount, currentIndex);
}
