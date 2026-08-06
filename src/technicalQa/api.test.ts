import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../types/electron';
import {
  cancelTechnicalQaTurn,
  fetchTechnicalQaEvents,
  fetchTechnicalQaHealth,
  fetchTechnicalQaThread,
  submitTechnicalQaQuestion,
  TechnicalQaApiError,
  uploadTechnicalQaDiagnostic,
} from './api';
import type { QaQuestionRequest } from './types';

type TestWindow = {
  electronAPI?: Partial<ElectronAPI>;
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  location?: { protocol: string };
};
type GlobalWithWindow = { window?: TestWindow };

const globalWithWindow = globalThis as unknown as GlobalWithWindow;
const originalWindow = globalWithWindow.window;
const sessionId = 'qa-session-0001';

const question: QaQuestionRequest = {
  schemaVersion: 1,
  clientRequestId: 'request-1',
  question: 'How does this ECA event work?',
  scope: { product: 'y3_editor', editorVersion: '2.0', domain: 'eca_editor' },
};

afterEach(() => {
  globalWithWindow.window = originalWindow;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Technical QA browser transport', () => {
  it('uploads diagnostic bytes as a strict JSON body with no local path authority', async () => {
    const accepted = {
      schemaVersion: 1 as const,
      uploadId: 'upload-opaque-1',
      kind: 'log' as const,
      displayName: 'game.log',
      mediaType: 'text/plain',
      decodedByteSize: 3,
      expiresAt: '2026-08-06T09:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(accepted, 201));
    vi.stubGlobal('fetch', fetchMock);
    globalWithWindow.window = testWindow();

    await expect(uploadTechnicalQaDiagnostic({
      schemaVersion: 1,
      clientUploadId: 'client-upload-1',
      kind: 'log',
      displayName: 'game.log',
      mediaType: 'text/plain',
      decodedByteSize: 3,
      contentBase64: 'YWJj',
    })).resolves.toEqual(accepted);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/qa/diagnostic-uploads');
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ contentBase64: 'YWJj' }));
    expect(String(init.body)).not.toMatch(/(?:file|project|storage)?path|provider|model|url|credential/i);
  });

  it.each([
    ['mismatched metadata', { kind: 'trace' }],
    ['invalid opaque ID', { uploadId: '../private' }],
    ['invalid decoded size', { decodedByteSize: 0 }],
    ['invalid expiry', { expiresAt: 'not-a-date' }],
    ['expired receipt', { expiresAt: '2000-01-01T00:00:00.000Z' }],
    ['unexpected fields', { storagePath: 'C:\\private\\upload.bin' }],
  ])('rejects %s in a diagnostic upload receipt', async (_label, override) => {
    const request = {
      schemaVersion: 1 as const, clientUploadId: 'client-upload-1', kind: 'log' as const,
      displayName: 'game.log', mediaType: 'text/plain', decodedByteSize: 3, contentBase64: 'YWJj',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      schemaVersion: 1, uploadId: 'upload-opaque-1', kind: 'log', displayName: 'game.log',
      mediaType: 'text/plain', decodedByteSize: 3, expiresAt: '2026-08-06T09:00:00.000Z',
      ...override,
    }, 201)));
    globalWithWindow.window = testWindow();

    await expect(uploadTechnicalQaDiagnostic(request)).rejects.toMatchObject({
      code: 'internal_error',
      message: 'Technical QA could not complete the request.',
    });
  });

  it('accepts a smaller decoded size after backend text sanitization', async () => {
    const accepted = {
      schemaVersion: 1 as const, uploadId: 'upload-opaque-1', kind: 'log' as const, displayName: 'game.log',
      mediaType: 'text/plain', decodedByteSize: 2, expiresAt: '2026-08-06T09:00:00.000Z',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(accepted, 201)));
    globalWithWindow.window = testWindow();

    await expect(uploadTechnicalQaDiagnostic({
      schemaVersion: 1, clientUploadId: 'client-upload-1', kind: 'log', displayName: 'game.log',
      mediaType: 'text/plain', decodedByteSize: 3, contentBase64: 'YQBi',
    })).resolves.toEqual(accepted);
  });

  it('rejects a smaller decoded size for screenshot receipts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      schemaVersion: 1, uploadId: 'upload-opaque-1', kind: 'screenshot', displayName: 'capture.png',
      mediaType: 'image/png', decodedByteSize: 2, expiresAt: '2026-08-06T09:00:00.000Z',
    }, 201)));
    globalWithWindow.window = testWindow();

    await expect(uploadTechnicalQaDiagnostic({
      schemaVersion: 1, clientUploadId: 'client-upload-1', kind: 'screenshot',
      displayName: 'capture.png', mediaType: 'image/png', decodedByteSize: 3, contentBase64: 'YWJj',
    })).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('uses only X-QA-Session for health and preserves unavailable health as state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ schemaVersion: 1, ready: false }, 503));
    vi.stubGlobal('fetch', fetchMock);
    globalWithWindow.window = testWindow();

    await expect(fetchTechnicalQaHealth()).resolves.toEqual({
      available: false,
      message: 'Technical QA service is currently unavailable.',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/qa/health', expect.objectContaining({
      method: 'GET',
      headers: { 'X-QA-Session': sessionId },
    }));
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toMatch(/ownerToken|[?&](?:session|token)=/i);
  });

  it('submits the frozen request body without session, provider, model, or project fields', async () => {
    const accepted = {
      schemaVersion: 1 as const,
      clientRequestId: 'request-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      acceptedAt: '2026-08-05T09:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(accepted, 202));
    vi.stubGlobal('fetch', fetchMock);
    globalWithWindow.window = testWindow();

    await expect(submitTechnicalQaQuestion(question)).resolves.toEqual(accepted);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/qa/turns');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-QA-Session': sessionId });
    expect(JSON.parse(String(init.body))).toEqual(question);
    expect(String(init.body)).not.toMatch(/session|ownerToken|provider|model|projectPath/i);
  });

  it('uses strict encoded thread/event/cancel paths without query credentials', async () => {
    const page = { schemaVersion: 1, threadId: 'thread-1', turnId: 'turn-1', events: [], nextCursor: 2, terminal: false };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: 1, threadId: 'thread-1', turns: [] }))
      .mockResolvedValueOnce(jsonResponse(page))
      .mockResolvedValueOnce(jsonResponse(page));
    vi.stubGlobal('fetch', fetchMock);
    globalWithWindow.window = testWindow();

    await fetchTechnicalQaThread('thread-1');
    await fetchTechnicalQaEvents({ schemaVersion: 1, threadId: 'thread-1', turnId: 'turn-1', after: 2 });
    await cancelTechnicalQaTurn({ schemaVersion: 1, threadId: 'thread-1', turnId: 'turn-1' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/qa/threads/thread-1',
      '/api/qa/threads/thread-1/turns/turn-1/events?after=2',
      '/api/qa/threads/thread-1/turns/turn-1/cancel',
    ]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/ownerToken|[?&](?:session|sessionId|token)=/i);
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ schemaVersion: 1 });
  });

  it('maps private or malformed backend failures to local public errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'internal_error', message: 'C:\\private\\runtime.jsonl TOKEN=secret' },
    }, 500)));
    globalWithWindow.window = testWindow();

    const error = await fetchTechnicalQaThread('thread-1').catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TechnicalQaApiError);
    expect(String(error)).toContain('Technical QA could not complete the request.');
    expect(String(error)).not.toMatch(/private|runtime\.jsonl|TOKEN|secret/i);
  });

  it('preserves retrieval failure semantics while sanitizing backend details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: 'retrieval_unavailable',
        message: 'Vector store at C:\\private\\evidence.db rejected TOKEN=secret',
      },
    }, 503)));
    globalWithWindow.window = testWindow();

    await expect(fetchTechnicalQaThread('thread-1')).rejects.toMatchObject({
      code: 'retrieval_unavailable',
      message: 'Technical QA could not retrieve evidence. Please try again.',
    });
  });
});

describe('Technical QA Electron transport', () => {
  it('uses the dedicated bridge with a header-only session input and structured bodies', async () => {
    const technicalQaRequest = vi.fn<NonNullable<ElectronAPI['technicalQaRequest']>>()
      .mockResolvedValue({ success: true, status: 202, payload: {
        schemaVersion: 1,
        clientRequestId: 'request-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        acceptedAt: '2026-08-05T09:00:00.000Z',
      } });
    globalWithWindow.window = testWindow({ technicalQaRequest });

    await submitTechnicalQaQuestion(question);

    expect(technicalQaRequest).toHaveBeenCalledWith({
      path: '/api/qa/turns',
      method: 'POST',
      body: question,
      sessionId,
    });
    expect(JSON.stringify(technicalQaRequest.mock.calls)).not.toMatch(/ownerToken|[?&](?:session|token)=/i);
  });

  it('sanitizes main-process transport failures', async () => {
    const technicalQaRequest = vi.fn<NonNullable<ElectronAPI['technicalQaRequest']>>()
      .mockResolvedValue({ success: false, status: 0, error: 'C:\\private\\TOKEN=secret' });
    globalWithWindow.window = testWindow({ technicalQaRequest });

    await expect(fetchTechnicalQaHealth()).rejects.toMatchObject({
      code: 'service_unavailable',
      message: 'Technical QA service is currently unavailable.',
    });
  });

  it('reuses the generic JSON bridge for diagnostic content without sending a local path', async () => {
    const technicalQaRequest = vi.fn<NonNullable<ElectronAPI['technicalQaRequest']>>()
      .mockResolvedValue({ success: true, status: 201, payload: {
        schemaVersion: 1, uploadId: 'opaque', kind: 'trace', displayName: 'runtime.trace',
        mediaType: 'text/plain', decodedByteSize: 3, expiresAt: '2026-08-06T09:00:00.000Z',
      } });
    globalWithWindow.window = testWindow({ technicalQaRequest });

    await uploadTechnicalQaDiagnostic({
      schemaVersion: 1, clientUploadId: 'client-1', kind: 'trace', displayName: 'runtime.trace',
      mediaType: 'text/plain', decodedByteSize: 3, contentBase64: 'YWJj',
    });

    expect(technicalQaRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: '/api/qa/diagnostic-uploads',
      method: 'POST',
      body: expect.objectContaining({ contentBase64: 'YWJj' }),
      sessionId,
    }));
    const bridgeBody = technicalQaRequest.mock.calls[0]?.[0].body;
    expect(JSON.stringify(bridgeBody)).not.toMatch(/(?:file|project|storage)?path/i);
  });
});

function testWindow(electronAPI?: Partial<ElectronAPI>): TestWindow {
  return {
    electronAPI,
    localStorage: createMemoryStorage(sessionId),
    location: { protocol: 'http:' },
  };
}

function createMemoryStorage(initialSession: string): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>([['technicalQa.sessionId', initialSession]]);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
