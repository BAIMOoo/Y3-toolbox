import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Technical QA Electron transport contract', () => {
  const mainSource = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const preloadSource = readFileSync(new URL('../../electron/preload.ts', import.meta.url), 'utf8');
  const typesSource = readFileSync(new URL('../types/electron.d.ts', import.meta.url), 'utf8');

  it('uses a dedicated IPC channel rather than the Agent Job request contract', () => {
    expect(mainSource).toContain("ipcMain.handle('technical-qa:request'");
    expect(mainSource).toContain('proxyTechnicalQaRequest(request)');
    expect(preloadSource).toContain("ipcRenderer.invoke('technical-qa:request', request)");
    expect(typesSource).toContain('technicalQaRequest?:');
  });

  it('pins requests to QA paths and forwards the session only as X-QA-Session', () => {
    const proxySource = mainSource.slice(
      mainSource.indexOf('async function proxyTechnicalQaRequest'),
      mainSource.indexOf('interface ResolvedArchiveInput'),
    );

    expect(proxySource).toContain("value.path.startsWith('/api/qa/')");
    expect(proxySource).toContain("'X-QA-Session': value.sessionId");
    expect(proxySource).toContain("['ownerToken', 'session', 'sessionId', 'token']");
    expect(proxySource).not.toContain("'X-Owner-Token'");
  });

  it('returns a generic bridge error instead of raw main-process details', () => {
    expect(mainSource).toContain("error: 'Technical QA service is unavailable.'");
  });
});
