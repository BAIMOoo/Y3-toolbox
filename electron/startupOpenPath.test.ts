import { describe, expect, it } from 'vitest';
import { findStartupOpenPath, isSupportedStartupOpenPath, type StartupOpenPathKind, type StartupOpenPathProbe } from './startupOpenPath';

function probe(entries: Record<string, StartupOpenPathKind>): StartupOpenPathProbe {
  const normalized = new Map(Object.entries(entries).map(([key, value]) => [key.replaceAll('\\', '/'), value]));
  return {
    statPath: async (candidatePath: string) => normalized.get(candidatePath.replaceAll('\\', '/')) ?? 'missing',
  };
}

describe('findStartupOpenPath', () => {
  it('ignores ordinary non-Windows startup argv', async () => {
    await expect(findStartupOpenPath(['/opt/app/app', '/tmp/log.csv'], 'linux', probe({ '/tmp/log.csv': 'file' }))).resolves.toBeNull();
  });

  it('does not treat Electron/Vite dev args as a startup file open', async () => {
    const fs = probe({
      'C:/repo/y3-toolbox': 'directory',
      'C:/repo/y3-toolbox/archive/archive_storage.json': 'missing',
      'C:/repo/y3-toolbox/electron/main.ts': 'file',
    });

    await expect(findStartupOpenPath([
      'C:/repo/y3-toolbox/node_modules/electron/dist/electron.exe',
      'C:/repo/y3-toolbox',
      '--inspect=0',
      'http://127.0.0.1:5173/',
    ], 'win32', fs)).resolves.toBeNull();
  });

  it('rejects an existing unsupported trailing file instead of scanning into earlier args', async () => {
    const fs = probe({
      'C:/repo/y3-toolbox': 'directory',
      'C:/repo/y3-toolbox/archive/archive_storage.json': 'file',
      'C:/tmp/readme.txt': 'file',
    });

    await expect(findStartupOpenPath([
      'C:/Program Files/App/app.exe',
      'C:/repo/y3-toolbox',
      'C:/tmp/readme.txt',
    ], 'win32', fs)).resolves.toBeNull();
  });

  it('accepts a trailing csv file association path', async () => {
    await expect(findStartupOpenPath([
      'C:/Program Files/App/app.exe',
      'C:/tmp/log.CSV',
    ], 'win32', probe({ 'C:/tmp/log.CSV': 'file' }))).resolves.toBe('C:/tmp/log.CSV');
  });

  it('accepts a trailing json archive path', async () => {
    await expect(findStartupOpenPath([
      'C:/Program Files/App/app.exe',
      'C:/tmp/archive_storage.JSON',
    ], 'win32', probe({ 'C:/tmp/archive_storage.JSON': 'file' }))).resolves.toBe('C:/tmp/archive_storage.JSON');
  });

  it('accepts a trailing Y3 project directory path', async () => {
    const fs = probe({
      'C:/Y3/MyProject': 'directory',
      'C:/Y3/MyProject/archive/archive_storage.json': 'file',
    });

    await expect(findStartupOpenPath([
      'C:/Program Files/App/app.exe',
      'C:/Y3/MyProject',
    ], 'win32', fs)).resolves.toBe('C:/Y3/MyProject');
  });

  it('accepts a trailing archive directory path inside a Y3 project', async () => {
    const fs = probe({
      'C:/Y3/MyProject/archive': 'directory',
      'C:/Y3/MyProject/archive/archive_storage.json': 'file',
    });

    await expect(findStartupOpenPath([
      'C:/Program Files/App/app.exe',
      'C:/Y3/MyProject/archive',
    ], 'win32', fs)).resolves.toBe('C:/Y3/MyProject/archive');
  });
});

describe('isSupportedStartupOpenPath', () => {
  it('rejects missing candidates', async () => {
    await expect(isSupportedStartupOpenPath('C:/tmp/log.csv', probe({}))).resolves.toBe(false);
  });
});
