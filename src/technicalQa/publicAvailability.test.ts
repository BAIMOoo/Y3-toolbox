import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('public Technical QA availability contract', () => {
  it('defaults the build flag off and defines it for renderer, main, and preload', () => {
    const vite = source('vite.config.ts');
    expect(vite).toContain("process.env.VITE_TECHNICAL_QA_ENABLED === '1'");
    expect(vite.match(/__TECHNICAL_QA_ENABLED__/g)).toHaveLength(3);
  });

  it('gates the navigation and workspace mount', () => {
    const app = source('src/App.tsx');
    expect(app).toContain('const TECHNICAL_QA_ENABLED = __TECHNICAL_QA_ENABLED__');
    expect(app).toContain("...(TECHNICAL_QA_ENABLED ? [{ label: '技术问答', value: 'technical-qa' as const }] : [])");
    expect(app).toContain("{TECHNICAL_QA_ENABLED && (");
  });

  it('gates the Electron request handler and preload API', () => {
    const main = source('electron/main.ts');
    const preload = source('electron/preload.ts');
    expect(main).toContain("if (BUILD_TECHNICAL_QA_ENABLED) {");
    expect(main).toContain("ipcMain.handle('technical-qa:request'");
    expect(preload).toContain('const technicalQaBridge = BUILD_TECHNICAL_QA_ENABLED');
    expect(preload).toContain('...technicalQaBridge');
  });

  it('pins the public release build to the disabled state', () => {
    expect(source('.github/workflows/release.yml')).toContain("VITE_TECHNICAL_QA_ENABLED: '0'");
  });
});
