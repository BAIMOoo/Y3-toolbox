import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Feedback Electron transport contract', () => {
  const mainSource = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  const preloadSource = readFileSync(new URL('../../electron/preload.ts', import.meta.url), 'utf8');
  const typesSource = readFileSync(new URL('../types/electron.d.ts', import.meta.url), 'utf8');

  it('uses a dedicated IPC channel and bridge method', () => {
    expect(mainSource).toContain("ipcMain.handle('feedback:request'");
    expect(mainSource).toContain('proxyFeedbackRequest(request)');
    expect(preloadSource).toContain("ipcRenderer.invoke('feedback:request', request)");
    expect(typesSource).toContain('feedbackRequest?:');
  });

  it('pins requests to feedback paths and forwards only X-Feedback-Session', () => {
    const proxySource = mainSource.slice(
      mainSource.indexOf('async function proxyFeedbackRequest'),
      mainSource.indexOf('interface ResolvedArchiveInput'),
    );

    expect(proxySource).toContain("value.path.startsWith('/api/feedback/')");
    expect(proxySource).toContain("value.path.includes('?')");
    expect(proxySource).toContain("value.path.includes('#')");
    expect(proxySource).toContain('decodeURIComponent(value.path)');
    expect(proxySource).toContain("segment === '.' || segment === '..'");
    expect(proxySource).toContain("'X-Feedback-Session': value.sessionId");
    expect(proxySource).toContain("['ownerToken', 'qaToken', 'session', 'sessionId', 'token']");
    expect(proxySource).not.toContain("'X-Owner-Token'");
    expect(proxySource).not.toContain("'X-QA-Session'");
    expect(proxySource).not.toContain('/api/qa/');
  });

  it('returns a generic bridge error instead of raw main-process details', () => {
    expect(mainSource).toContain("error: 'Feedback service is unavailable.'");
  });
});
