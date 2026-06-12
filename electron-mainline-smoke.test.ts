import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Electron mainline static smoke coverage', () => {
  it('keeps npm defaults pointed at the Electron route without Web-only scripts', () => {
    const pkg = JSON.parse(read('package.json')) as { main: string; scripts: Record<string, string> };
    expect(pkg.main).toBe('dist-electron/main.js');
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.scripts['dev:electron']).toBe('vite');
    expect(pkg.scripts['dev:web']).toBeUndefined();
    expect(pkg.scripts.server).toBeUndefined();
  });

  it('builds Electron main and preload entries through the default Vite config', () => {
    const viteConfig = read('vite.config.ts');
    expect(viteConfig).toContain("electron([");
    expect(viteConfig).toContain("entry: 'electron/main.ts'");
    expect(viteConfig).toContain("entry: 'electron/preload.ts'");
    expect(viteConfig).toContain('vite-plugin-electron-renderer');
  });

  it('keeps local input IPC wired without weakening preload isolation', () => {
    const main = read('electron/main.ts');
    const preload = read('electron/preload.ts');

    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("ipcMain.handle('fs:readFile'");
    expect(main).toContain("ipcMain.handle('archive:readInput'");
    expect(main).toContain("ipcMain.handle('dialog:openArchiveDirectory'");

    expect(preload).toContain("contextBridge.exposeInMainWorld('electronAPI'");
    expect(preload).toContain("readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath)");
    expect(preload).toContain("readArchiveInput: (inputPath: string) => ipcRenderer.invoke('archive:readInput', inputPath)");
  });

  it('shares local input extension rules between renderer routing and Electron archive validation', () => {
    const routing = read('src/utils/openFileRouting.ts');
    const archiveContract = read('src/archiveViewer/archiveFileContract.ts');
    const localContract = read('src/utils/localInputContract.ts');

    expect(routing).toContain("from './localInputContract'");
    expect(archiveContract).toContain("from '../utils/localInputContract'");
    expect(localContract).toContain("export const DIFF_CSV_EXTENSION = '.csv'");
    expect(localContract).toContain("export const ARCHIVE_JSON_EXTENSION = '.json'");
  });
});
