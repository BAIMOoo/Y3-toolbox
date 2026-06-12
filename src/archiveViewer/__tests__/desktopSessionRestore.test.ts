import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE } from '../useLocalArchiveViewer';
import { parseArchiveSession, serializeArchiveSession } from '../archiveSession';

describe('desktop archive session restore boundaries', () => {
  it('keeps restore payloads path-only so Electron can revalidate them on startup', () => {
    const raw = serializeArchiveSession(['C:/Y3/ProjectA', '', 'C:/Y3/ProjectB/archive/archive_storage.json'], 99);
    expect(JSON.parse(raw)).toEqual({
      tabs: ['C:/Y3/ProjectA', 'C:/Y3/ProjectB/archive/archive_storage.json'],
      current: 1,
    });
  });

  it('does not treat browser File names as Electron-validated restored paths', () => {
    const parsed = parseArchiveSession(JSON.stringify({ tabs: ['archive_storage.json', 123, ''], current: 0 }));
    expect(parsed).toEqual({ tabs: ['archive_storage.json'], current: 0 });
    expect(LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE).toContain('桌面版');
  });

  it('keeps browser restore/openPath guarded by Electron archive IPC', () => {
    const source = readFileSync('src/archiveViewer/useLocalArchiveViewer.ts', 'utf8');
    expect(source).toContain('if (!window.electronAPI?.readArchiveInput)');
    expect(source).toContain('localStorage.removeItem(SESSION_KEY)');
    expect(source).toContain('setError(LOCAL_ARCHIVE_BROWSER_UNSUPPORTED_MESSAGE)');
  });
});
