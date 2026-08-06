import { afterEach, describe, expect, it, vi } from 'vitest';
import { technicalQaApi } from './api';
import {
  createTechnicalQaController,
  type TechnicalQaControllerOptions,
} from './controller';
import { QA_CLIENT_EVENT_FIXTURES } from './fixtures';
import type {
  QaEvent,
  QaEventPage,
  QaQuestionRequest,
  QaTerminalOutcome,
} from './types';

const immediateSleep: NonNullable<TechnicalQaControllerOptions['sleep']> = async () => undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Technical QA client-to-backend contract workflow', () => {
  it('uploads selected diagnostic bytes before submitting only opaque references', async () => {
    const question = 'Diagnose the attached Trace';
    const fixture = new TechnicalQaHttpFixture(new Map([
      [question, QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp],
    ]));
    vi.stubGlobal('fetch', vi.fn(fixture.fetch));
    const controller = createController(['thread-key', 'client-upload-id', 'request-with-diagnostic']);

    await controller.addAttachments([file('runtime.trace', 'text/plain', 'trace line')]);
    controller.setDraft(question);
    await controller.submit();

    expect(fixture.calls.map((call) => call.url).slice(0, 2)).toEqual([
      '/api/qa/diagnostic-uploads',
      '/api/qa/turns',
    ]);
    expect(fixture.uploads).toEqual([expect.objectContaining({
      clientUploadId: 'client-upload-id',
      kind: 'trace',
      displayName: 'runtime.trace',
      contentBase64: btoa('trace line'),
    })]);
    expect(fixture.submissions[0]?.diagnosticUploadIds).toEqual(['opaque-upload-1']);
    expect(JSON.stringify(fixture.submissions)).not.toMatch(/contentBase64|(?:file|project|storage)?path/i);
    expect(activeThread(controller).turns[0]?.attachments).toEqual([
      { kind: 'trace', displayName: 'runtime.trace', decodedByteSize: 10 },
    ]);
  });

  it('drives ECA and Lua HTTP turns through strict polling into retained controller history', async () => {
    const fixture = new TechnicalQaHttpFixture(new Map([
      ['How does this ECA event work?', QA_CLIENT_EVENT_FIXTURES.ecaAnswer],
      ['How does the timer API work?', QA_CLIENT_EVENT_FIXTURES.luaAnswer],
    ]));
    vi.stubGlobal('fetch', vi.fn(fixture.fetch));
    const controller = createController(['thread-key', 'request-eca', 'request-lua']);

    await controller.initialize();
    controller.setDraft('How does this ECA event work?');
    await controller.submit();
    controller.setDomain('lua_y3_lualib');
    controller.setDraft('How does the timer API work?');
    await controller.submit();

    const thread = activeThread(controller);
    expect(thread.turns.map((turn) => [turn.domain, turn.state.status])).toEqual([
      ['eca_editor', 'answer'],
      ['lua_y3_lualib', 'answer'],
    ]);
    expect(thread.turns.map((turn) => turn.state.answerText)).toEqual([
      'Create an ECA trigger for the event.',
      'Use the maintained timer loop API.',
    ]);
    expect(fixture.submissions[1]).toMatchObject({
      threadId: fixture.submissions[0]?.threadId ?? thread.threadId,
      scope: { domain: 'lua_y3_lualib' },
    });
    expect(fixture.eventCursors).toEqual([0, 3, 0, 3]);
    expect(fixture.calls.every((call) => call.sessionId === 'test-qa-session-0001')).toBe(true);
    expect(fixture.calls.map((call) => call.url).join('\n')).not.toMatch(/[?&](?:session|token)=|ownerToken/i);
    expect(JSON.stringify(fixture.calls.map((call) => call.body))).not.toMatch(
      /ownerToken|provider|model|projectPath/i,
    );
  });

  it.each([
    ['follow_up', 'ambiguous', QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp],
    ['refusal', 'conflicting', QA_CLIENT_EVENT_FIXTURES.conflictingRefusal],
    ['refusal', 'unanswerable', QA_CLIENT_EVENT_FIXTURES.underEvidencedRefusal],
    ['refusal', 'forbidden capability', QA_CLIENT_EVENT_FIXTURES.forbiddenRefusal],
  ] as const)('consumes a terminal %s outcome for a %s question', async (status, label, page) => {
    const question = `${label} question`;
    const fixture = new TechnicalQaHttpFixture(new Map([[question, page]]));
    vi.stubGlobal('fetch', vi.fn(fixture.fetch));
    const controller = createController(['thread-key', `request-${label}`]);
    controller.setDraft(question);

    await controller.submit();

    const turn = activeThread(controller).turns[0]!;
    expect(turn.state).toMatchObject({ status, terminal: true });
    expect(turn.state.answerText).toBe('');
  });

  it('posts cancellation and converges the pending poll on a cancelled terminal event', async () => {
    const question = 'Cancel this question';
    const fixture = new TechnicalQaHttpFixture(new Map([
      [question, QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp],
    ]), { cancellationQuestion: question });
    vi.stubGlobal('fetch', vi.fn(fixture.fetch));
    const controller = createController(['thread-key', 'request-cancel']);
    controller.setDraft(question);

    const submission = controller.submit();
    await vi.waitFor(() => expect(fixture.eventCursors).toEqual([0, 3]));
    await controller.cancelActiveTurn();
    await submission;

    expect(fixture.cancelRequests).toEqual([{ schemaVersion: 1 }]);
    expect(activeThread(controller).turns[0]?.state).toMatchObject({ status: 'cancelled', terminal: true });
  });

  it('sanitizes private HTTP failure details before they enter controller state', async () => {
    const question = 'Trigger a service failure';
    const fixture = new TechnicalQaHttpFixture(new Map([
      [question, QA_CLIENT_EVENT_FIXTURES.ecaAnswer],
    ]), { failureQuestion: question });
    vi.stubGlobal('fetch', vi.fn(fixture.fetch));
    const controller = createController(['thread-key', 'request-failure'], { maxConsecutivePollFailures: 1 });
    controller.setDraft(question);

    await controller.submit();

    const snapshot = controller.getSnapshot();
    expect(activeThread(controller).turns[0]?.state.outcome).toEqual({
      kind: 'error',
      code: 'service_unavailable',
      message: 'The answer stream could not be completed. Please try again.',
      retryable: true,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/private|runtime\.jsonl|TOKEN|secret/i);
  });
});

interface FixtureOptions {
  cancellationQuestion?: string;
  failureQuestion?: string;
}

interface FixtureCall {
  url: string;
  method: string;
  sessionId: string | null;
  body?: unknown;
}

interface FixtureTurn {
  question: string;
  page: QaEventPage;
  pendingPoll?: (page: QaEventPage) => void;
}

class TechnicalQaHttpFixture {
  readonly calls: FixtureCall[] = [];
  readonly uploads: Array<Record<string, unknown>> = [];
  readonly submissions: QaQuestionRequest[] = [];
  readonly eventCursors: number[] = [];
  readonly cancelRequests: unknown[] = [];
  private readonly scenarios: ReadonlyMap<string, QaEventPage>;
  private readonly options: FixtureOptions;
  private readonly turns = new Map<string, FixtureTurn>();

  constructor(scenarios: ReadonlyMap<string, QaEventPage>, options: FixtureOptions = {}) {
    this.scenarios = scenarios;
    this.options = options;
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsedUrl = new URL(url, 'http://technical-qa.fixture');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) as unknown : undefined;
    this.calls.push({
      url: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      sessionId: new Headers(init.headers).get('X-QA-Session'),
      body,
    });

    if (method === 'GET' && parsedUrl.pathname === '/api/qa/health') {
      return jsonResponse({ schemaVersion: 1, ready: true });
    }
    if (method === 'POST' && parsedUrl.pathname === '/api/qa/turns') {
      return this.acceptTurn(body as QaQuestionRequest);
    }
    if (method === 'POST' && parsedUrl.pathname === '/api/qa/diagnostic-uploads') {
      const upload = body as Record<string, unknown>;
      this.uploads.push(upload);
      return jsonResponse({
        schemaVersion: 1,
        uploadId: `opaque-upload-${this.uploads.length}`,
        kind: upload.kind,
        displayName: upload.displayName,
        mediaType: upload.mediaType,
        decodedByteSize: upload.decodedByteSize,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }, 201);
    }

    const eventMatch = parsedUrl.pathname.match(/^\/api\/qa\/threads\/([^/]+)\/turns\/([^/]+)\/events$/);
    if (method === 'GET' && eventMatch) {
      return this.readEvents(decodeURIComponent(eventMatch[2]!), Number(parsedUrl.searchParams.get('after')));
    }
    const cancelMatch = parsedUrl.pathname.match(/^\/api\/qa\/threads\/([^/]+)\/turns\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      return this.cancelTurn(decodeURIComponent(cancelMatch[2]!), body);
    }
    return jsonResponse({ error: { code: 'invalid_request' } }, 400);
  };

  private acceptTurn(request: QaQuestionRequest): Response {
    const source = this.scenarios.get(request.question);
    if (!source) return jsonResponse({ error: { code: 'invalid_request' } }, 400);
    const index = this.submissions.length + 1;
    const threadId = request.threadId ?? 'thread-contract';
    const turnId = `turn-contract-${index}`;
    this.submissions.push({ ...request, threadId });
    this.turns.set(turnId, { question: request.question, page: rebindPage(source, threadId, turnId) });
    return jsonResponse({
      schemaVersion: 1,
      clientRequestId: request.clientRequestId,
      threadId,
      turnId,
      acceptedAt: `2026-08-05T12:00:0${index}.000Z`,
    }, 202);
  }

  private async readEvents(turnId: string, after: number): Promise<Response> {
    this.eventCursors.push(after);
    const turn = this.turns.get(turnId);
    if (!turn) return jsonResponse({ error: { code: 'invalid_request' } }, 404);
    if (turn.question === this.options.failureQuestion) {
      return jsonResponse({
        error: { code: 'internal_error', message: 'C:\\private\\runtime.jsonl TOKEN=secret' },
      }, 500);
    }
    if (after === 0) return jsonResponse(slicePage(turn.page, 0, 3, false));
    if (turn.question === this.options.cancellationQuestion) {
      return new Promise((resolve) => {
        turn.pendingPoll = (page) => resolve(jsonResponse(page));
      });
    }
    return jsonResponse(slicePage(turn.page, after, turn.page.events.length, true));
  }

  private cancelTurn(turnId: string, body: unknown): Response {
    this.cancelRequests.push(body);
    const turn = this.turns.get(turnId);
    if (!turn) return jsonResponse({ error: { code: 'invalid_request' } }, 404);
    const outcome: QaTerminalOutcome = { kind: 'cancelled', message: 'Cancelled.' };
    const event: QaEvent = {
      schemaVersion: 1,
      eventId: `${turnId}-cancelled`,
      threadId: turn.page.threadId,
      turnId,
      sequence: 4,
      type: 'turn.completed',
      createdAt: '2026-08-05T12:00:09.000Z',
      payload: { type: 'turn.completed', outcome },
    };
    const page: QaEventPage = {
      schemaVersion: 1,
      threadId: turn.page.threadId,
      turnId,
      events: [event],
      nextCursor: 4,
      terminal: true,
    };
    turn.pendingPoll?.(page);
    return jsonResponse(page);
  }
}

function createController(ids: string[], overrides: TechnicalQaControllerOptions = {}) {
  return createTechnicalQaController(technicalQaApi, {
    sleep: immediateSleep,
    createId: () => ids.shift() ?? 'unexpected-id',
    now: () => '2026-08-05T12:00:00.000Z',
    ...overrides,
  });
}

function activeThread(controller: ReturnType<typeof createTechnicalQaController>) {
  const snapshot = controller.getSnapshot();
  return snapshot.threads.find((thread) => thread.key === snapshot.activeThreadKey)!;
}

function rebindPage(source: QaEventPage, threadId: string, turnId: string): QaEventPage {
  return {
    ...source,
    threadId,
    turnId,
    events: source.events.map((event) => ({
      ...event,
      eventId: `${turnId}-${event.sequence}`,
      threadId,
      turnId,
    })),
  };
}

function slicePage(source: QaEventPage, after: number, through: number, terminal: boolean): QaEventPage {
  return {
    ...source,
    events: source.events.filter((event) => event.sequence > after && event.sequence <= through),
    nextCursor: through,
    terminal,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function file(name: string, type: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  } as unknown as File;
}
