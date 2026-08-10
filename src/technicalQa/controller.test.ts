import { describe, expect, it, vi } from 'vitest';
import { QA_CLIENT_EVENT_FIXTURES } from './fixtures';
import { TechnicalQaApiError } from './api';
import {
  createTechnicalQaController,
  type QaControllerApi,
  type QaServiceHealth,
  type TechnicalQaControllerOptions,
} from './controller';
import type { QaEventPage, QaQuestionAccepted, QaTerminalOutcome } from './types';

const immediateSleep: NonNullable<TechnicalQaControllerOptions['sleep']> = async () => undefined;

function accepted(clientRequestId = 'request-1'): QaQuestionAccepted {
  return {
    schemaVersion: 1,
    clientRequestId,
    threadId: 'thread-fixture',
    turnId: 'turn-fixture',
    acceptedAt: '2026-08-05T09:00:00.000Z',
  };
}

function fakeApi(pages: QaEventPage[], health: QaServiceHealth = { available: true }): QaControllerApi {
  let pageIndex = 0;
  return {
    health: vi.fn().mockResolvedValue(health),
    uploadDiagnostic: vi.fn(async (request) => ({
      schemaVersion: 1 as const,
      uploadId: `opaque-${request.clientUploadId}`,
      kind: request.kind,
      displayName: request.displayName,
      mediaType: request.mediaType,
      decodedByteSize: request.decodedByteSize,
      expiresAt: '2026-08-06T09:00:00.000Z',
    })),
    submit: vi.fn(async (request) => accepted(request.clientRequestId)),
    events: vi.fn(async () => pages[Math.min(pageIndex++, pages.length - 1)]!),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

function activeTurn(controller: ReturnType<typeof createTechnicalQaController>) {
  const snapshot = controller.getSnapshot();
  const thread = snapshot.threads.find((candidate) => candidate.key === snapshot.activeThreadKey)!;
  return thread.turns.at(-1)!;
}

describe('TechnicalQaController', () => {
  it('uploads attachments before submit and sends only opaque upload IDs with the turn', async () => {
    const order: string[] = [];
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    vi.mocked(api.uploadDiagnostic).mockImplementation(async (request) => {
      order.push(`upload:${request.displayName}`);
      return {
        schemaVersion: 1, uploadId: `opaque-${request.clientUploadId}`, kind: request.kind,
        displayName: request.displayName, mediaType: request.mediaType,
        decodedByteSize: request.decodedByteSize, expiresAt: '2026-08-06T09:00:00.000Z',
      };
    });
    vi.mocked(api.submit).mockImplementation(async (request) => {
      order.push('submit');
      return accepted(request.clientRequestId);
    });
    const ids = ['thread-key', 'attachment-client', 'request-client'];
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => ids.shift()! });
    await controller.addAttachments([file('runtime.trace', 'text/plain', 'trace')]);
    controller.setDraft('Diagnose this trace');

    await controller.submit();

    expect(order).toEqual(['upload:runtime.trace', 'submit']);
    expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({
      diagnosticUploadIds: ['opaque-attachment-client'],
    }), expect.any(AbortSignal));
    expect(activeTurn(controller).attachments).toEqual([
      { kind: 'trace', displayName: 'runtime.trace', decodedByteSize: 5 },
    ]);
    expect(controller.getSnapshot().pendingAttachments).toEqual([]);
    expect(JSON.stringify(vi.mocked(api.submit).mock.calls)).not.toMatch(/contentBase64|localPath|filePath/i);
  });

  it('keeps the draft and all removable pending items when a later upload fails', async () => {
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    vi.mocked(api.uploadDiagnostic)
      .mockResolvedValueOnce({
        schemaVersion: 1, uploadId: 'opaque-first', kind: 'log', displayName: 'game.log',
        mediaType: 'text/plain', decodedByteSize: 3, expiresAt: '2026-08-06T09:00:00.000Z',
      })
      .mockRejectedValueOnce(new Error('C:\\private\\upload-store'))
      .mockResolvedValueOnce({
        schemaVersion: 1, uploadId: 'opaque-second', kind: 'trace', displayName: 'runtime.trace',
        mediaType: 'text/plain', decodedByteSize: 5, expiresAt: '2026-08-06T09:00:00.000Z',
      });
    const ids = ['thread-key', 'attachment-first', 'attachment-second', 'request-client'];
    const controller = createTechnicalQaController(api, { createId: () => ids.shift()! });
    await controller.addAttachments([
      file('game.log', 'text/plain', 'log'),
      file('runtime.trace', 'text/plain', 'trace'),
    ]);
    controller.setDraft('Diagnose this log');

    await controller.submit();

    expect(api.submit).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      draft: 'Diagnose this log',
      attachmentError: '附件上传失败，请检查文件后重试。',
      pendingAttachments: [
        { clientUploadId: 'attachment-first', uploadId: 'opaque-first', status: 'uploaded' },
        { clientUploadId: 'attachment-second', status: 'error' },
      ],
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('upload-store');

    await controller.submit();

    expect(api.uploadDiagnostic).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.uploadDiagnostic).mock.calls.map(([upload]) => upload.clientUploadId)).toEqual([
      'attachment-first',
      'attachment-second',
      'attachment-second',
    ]);
    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.clientRequestId)).toEqual(['request-client']);
    expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({
      diagnosticUploadIds: ['opaque-first', 'opaque-second'],
    }), expect.any(AbortSignal));
    expect(controller.getSnapshot().pendingAttachments).toEqual([]);
  });

  it('reports a submit failure separately after uploads complete and keeps attachments retryable', async () => {
    const api = fakeApi([]);
    vi.mocked(api.submit).mockRejectedValue(new Error('private turn failure'));
    const ids = ['thread-key', 'attachment-client', 'request-client'];
    const controller = createTechnicalQaController(api, { createId: () => ids.shift()! });
    await controller.addAttachments([file('game.log', 'text/plain', 'log')]);
    controller.setDraft('Diagnose this log');

    await controller.submit();

    expect(controller.getSnapshot()).toMatchObject({
      draft: 'Diagnose this log',
      serviceMessage: 'The question could not be submitted. Please try again.',
      attachmentError: undefined,
      pendingAttachments: [{ clientUploadId: 'attachment-client', uploadId: 'opaque-attachment-client', status: 'uploaded' }],
    });
  });

  it('reuses request and upload IDs after an ambiguous response loss', async () => {
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    vi.mocked(api.submit)
      .mockRejectedValueOnce(new TypeError('network response lost'))
      .mockImplementationOnce(async (request) => accepted(request.clientRequestId));
    const ids = ['thread-key', 'attachment-client', 'stable-request'];
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => ids.shift()! });
    await controller.addAttachments([file('game.log', 'text/plain', 'log')]);
    controller.setDraft('Diagnose response loss');

    await controller.submit();
    await controller.submit();

    expect(api.uploadDiagnostic).toHaveBeenCalledOnce();
    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.clientRequestId)).toEqual([
      'stable-request',
      'stable-request',
    ]);
    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.diagnosticUploadIds)).toEqual([
      ['opaque-attachment-client'],
      ['opaque-attachment-client'],
    ]);
  });

  it('aborts a pre-accept upload and keeps the draft and attachments retryable', async () => {
    const api = fakeApi([]);
    vi.mocked(api.uploadDiagnostic).mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const ids = ['thread-key', 'attachment-client', 'request-client'];
    const controller = createTechnicalQaController(api, { createId: () => ids.shift()! });
    await controller.addAttachments([file('game.log', 'text/plain', 'log')]);
    controller.setDraft('Cancel this upload');

    const submission = controller.submit();
    await vi.waitFor(() => expect(api.uploadDiagnostic).toHaveBeenCalledOnce());
    const signal = vi.mocked(api.uploadDiagnostic).mock.calls[0]?.[1];
    await controller.cancelActiveTurn();
    await submission;

    expect(signal?.aborted).toBe(true);
    expect(api.cancel).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      draft: 'Cancel this upload',
      submitting: false,
      attachmentError: undefined,
      serviceMessage: undefined,
      pendingAttachments: [{ clientUploadId: 'attachment-client', status: 'pending' }],
    });
  });

  it('aborts a pre-accept submit while preserving its exact retry identity', async () => {
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    vi.mocked(api.submit)
      .mockImplementationOnce((_request, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }))
      .mockImplementationOnce(async (request) => accepted(request.clientRequestId));
    const ids = ['thread-key', 'attachment-client', 'stable-request'];
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => ids.shift()! });
    await controller.addAttachments([file('game.log', 'text/plain', 'log')]);
    controller.setDraft('Cancel this submit');

    const firstSubmission = controller.submit();
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    await controller.cancelActiveTurn();
    await firstSubmission;
    await controller.submit();

    expect(api.uploadDiagnostic).toHaveBeenCalledOnce();
    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.clientRequestId)).toEqual([
      'stable-request',
      'stable-request',
    ]);
    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.diagnosticUploadIds)).toEqual([
      ['opaque-attachment-client'],
      ['opaque-attachment-client'],
    ]);
  });

  it('rotates request and upload idempotency keys after submit-stage invalid_request', async () => {
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    vi.mocked(api.submit)
      .mockRejectedValueOnce(new TechnicalQaApiError('invalid_request', 400))
      .mockImplementationOnce(async (request) => accepted(request.clientRequestId));
    const ids = ['thread-key', 'attachment-one', 'request-one', 'attachment-two', 'request-two'];
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => ids.shift()! });
    await controller.addAttachments([file('game.log', 'text/plain', 'log')]);
    controller.setDraft('Retry an expired receipt');

    await controller.submit();
    expect(controller.getSnapshot().pendingAttachments).toEqual([
      expect.objectContaining({ clientUploadId: 'attachment-two', uploadId: undefined, status: 'pending' }),
    ]);
    await controller.submit();

    expect(vi.mocked(api.uploadDiagnostic).mock.calls.map(([request]) => request.clientUploadId)).toEqual([
      'attachment-one',
      'attachment-two',
    ]);
    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.clientRequestId)).toEqual([
      'request-one',
      'request-two',
    ]);
  });

  it('creates a new request ID when draft, domain, thread, or attachment inputs change', async () => {
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    vi.mocked(api.submit)
      .mockRejectedValueOnce(new TypeError('response unavailable'))
      .mockRejectedValueOnce(new TypeError('response unavailable'))
      .mockImplementationOnce(async (request) => accepted(request.clientRequestId))
      .mockRejectedValue(new TypeError('response unavailable'));
    const ids = [
      'thread-one',
      'attachment-one',
      'request-one',
      'request-draft',
      'request-domain',
      'thread-two',
      'request-thread',
      'attachment-two',
      'request-attachments',
    ];
    const controller = createTechnicalQaController(api, { createId: () => ids.shift()! });
    await controller.addAttachments([file('game.log', 'text/plain', 'log')]);
    controller.setDraft('Question one');
    await controller.submit();

    controller.setDraft('Question two');
    await controller.submit();
    controller.setDomain('lua_y3_lualib');
    await controller.submit();
    controller.startNewThread();
    controller.setDraft('Question on another thread');
    await controller.submit();
    await controller.addAttachments([file('runtime.trace', 'text/plain', 'trace')]);
    await controller.submit();

    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.clientRequestId)).toEqual([
      'request-one',
      'request-draft',
      'request-domain',
      'request-thread',
      'request-attachments',
    ]);
    expect(vi.mocked(api.uploadDiagnostic).mock.calls.map(([upload]) => upload.clientUploadId)).toEqual([
      'attachment-one',
      'attachment-two',
    ]);
    expect(vi.mocked(api.submit).mock.calls.map(([request]) => request.diagnosticUploadIds)).toEqual([
      ['opaque-attachment-one'],
      ['opaque-attachment-one'],
      ['opaque-attachment-one'],
      undefined,
      ['opaque-attachment-two'],
    ]);
  });

  it('polls with strict cursors and preserves incremental answer state', async () => {
    const complete = QA_CLIENT_EVENT_FIXTURES.ecaAnswer;
    const firstPage: QaEventPage = {
      ...complete,
      events: complete.events.slice(0, 4),
      nextCursor: 4,
      terminal: false,
    };
    const duplicateAndComplete: QaEventPage = {
      ...complete,
      events: [complete.events[3]!, ...complete.events.slice(4)],
    };
    const api = fakeApi([firstPage, duplicateAndComplete]);
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => 'request-1' });
    const statuses: string[] = [];
    controller.subscribe(() => {
      const turn = activeTurn(controller);
      if (turn) statuses.push(turn.state.status);
    });
    controller.setDraft('How does this ECA event work?');

    await controller.submit();

    expect(api.events).toHaveBeenNthCalledWith(1, expect.objectContaining({ after: 0 }), expect.any(AbortSignal));
    expect(api.events).toHaveBeenNthCalledWith(2, expect.objectContaining({ after: 4 }), expect.any(AbortSignal));
    expect(statuses).toContain('streaming');
    expect(activeTurn(controller).state).toMatchObject({ status: 'answer', terminal: true });
    expect(activeTurn(controller).state.answerText).toBe('Create an ECA trigger for the event.');
  });

  it('continues past the legacy 240 non-terminal poll ceiling by default and accepts the backend terminal answer', async () => {
    const emptyPage: QaEventPage = {
      schemaVersion: 1,
      threadId: 'thread-fixture',
      turnId: 'turn-fixture',
      events: [],
      nextCursor: 0,
      terminal: false,
    };
    const api = fakeApi([
      ...Array.from({ length: 240 }, () => emptyPage),
      QA_CLIENT_EVENT_FIXTURES.ecaAnswer,
    ]);
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => 'request-1' });
    controller.setDraft('Slow but valid answer');

    await controller.submit();

    expect(api.events).toHaveBeenCalledTimes(241);
    expect(activeTurn(controller).state).toMatchObject({ status: 'answer', terminal: true });
    expect(activeTurn(controller).state.outcome).toMatchObject({
      kind: 'answer',
      answer: 'Create an ECA trigger for the event.',
    });
  });

  it('keeps waiting through transient poll failures by default and clears reconnect status after recovery', async () => {
    const api = fakeApi([]);
    vi.mocked(api.events)
      .mockRejectedValueOnce(new Error('temporary socket reset with private details'))
      .mockRejectedValueOnce(new Error('temporary socket reset with private details'))
      .mockResolvedValueOnce(QA_CLIENT_EVENT_FIXTURES.ecaAnswer);
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => 'request-1' });
    controller.setDraft('Recover this answer');

    await controller.submit();

    expect(api.events).toHaveBeenCalledTimes(3);
    expect(activeTurn(controller).state).toMatchObject({ status: 'answer', terminal: true });
    expect(controller.getSnapshot().serviceMessage).toBeUndefined();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('temporary socket reset');
  });

  it('stops polling when the backend says the event cursor has expired', async () => {
    const api = fakeApi([]);
    vi.mocked(api.events)
      .mockRejectedValueOnce(new TechnicalQaApiError('cursor_expired', 410))
      .mockResolvedValueOnce(QA_CLIENT_EVENT_FIXTURES.ecaAnswer);
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => 'request-1' });
    controller.setDraft('Do not retry an expired cursor');

    await controller.submit();

    expect(api.events).toHaveBeenCalledOnce();
    expect(activeTurn(controller).state).toMatchObject({
      status: 'error',
      terminal: true,
      outcome: { kind: 'error', code: 'cursor_expired' },
    });
    expect(controller.getSnapshot().serviceMessage).toBeUndefined();
  });

  it('restores an accepted non-terminal turn from storage and resumes polling after initialize', async () => {
    const complete = QA_CLIENT_EVENT_FIXTURES.ecaAnswer;
    const firstPage: QaEventPage = {
      ...complete,
      events: complete.events.slice(0, 3),
      nextCursor: 3,
      terminal: false,
    };
    let sleepSignal: AbortSignal | undefined;
    const storage = createMemoryStorage();
    const firstApi = fakeApi([firstPage]);
    const firstController = createTechnicalQaController(firstApi, {
      storage,
      createId: () => 'request-1',
      sleep: (_milliseconds, signal) => {
        sleepSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    firstController.setDraft('Restore this pending answer');

    const firstSubmit = firstController.submit();
    await vi.waitFor(() => expect(sleepSignal).toBeDefined());
    firstController.dispose();
    await firstSubmit;

    expect(storage.getItem('technicalQa.pendingTurn.v1')).toContain('Restore this pending answer');

    const restoredApi = fakeApi([{
      ...complete,
      events: complete.events.slice(3),
    }]);
    const restoredController = createTechnicalQaController(restoredApi, {
      storage,
      sleep: immediateSleep,
      createId: () => 'new-empty-thread',
    });

    await restoredController.initialize();
    await vi.waitFor(() => expect(activeTurn(restoredController).state.status).toBe('answer'));

    expect(restoredApi.submit).not.toHaveBeenCalled();
    expect(restoredApi.events).toHaveBeenCalledWith(expect.objectContaining({ after: 3 }), expect.any(AbortSignal));
    expect(activeTurn(restoredController).question).toBe('Restore this pending answer');
    expect(storage.getItem('technicalQa.pendingTurn.v1')).toBeNull();
  });

  it('rejects malformed restored turn state without polling or leaking untrusted state fields', async () => {
    const storage = createMemoryStorage();
    storage.setItem('technicalQa.pendingTurn.v1', JSON.stringify({
      schemaVersion: 1,
      thread: {
        key: 'thread-key',
        threadId: 'thread-fixture',
        title: 'Malicious',
        createdAt: '2026-08-05T09:00:00.000Z',
        updatedAt: '2026-08-05T09:00:00.000Z',
        turns: [],
      },
      turn: {
        clientRequestId: 'request-1',
        question: 'Malicious pending question',
        domain: 'bad-domain',
        submittedAt: '2026-08-05T09:00:00.000Z',
        state: {
          threadId: 'thread-fixture',
          turnId: 'turn-fixture',
          lastSequence: -1,
          answerText: '<script>do-not-trust</script>',
          status: 'answer',
          terminal: false,
          outcome: { kind: 'answer', answer: 'forged' },
        },
      },
    }));
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    const controller = createTechnicalQaController(api, {
      storage,
      sleep: immediateSleep,
      createId: () => 'fresh-thread',
    });

    await controller.initialize();

    expect(api.events).not.toHaveBeenCalled();
    expect(controller.getSnapshot().threads).toEqual([
      expect.objectContaining({ key: 'fresh-thread', turns: [] }),
    ]);
    expect(storage.getItem('technicalQa.pendingTurn.v1')).toBeNull();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('do-not-trust');
  });

  it('treats storage SecurityError as unavailable storage and continues without throwing', async () => {
    const storage = throwingStorage();
    const api = fakeApi([QA_CLIENT_EVENT_FIXTURES.ecaAnswer]);
    const controller = createTechnicalQaController(api, {
      storage,
      sleep: immediateSleep,
      createId: () => 'request-1',
    });
    controller.setDraft('Storage failure should not break QA');

    await controller.initialize();
    await controller.submit();

    expect(activeTurn(controller).state.status).toBe('answer');
    expect(storage.getItem).toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it('can cancel a restored pending turn before health recovery starts polling and clears storage', async () => {
    const storage = createMemoryStorage();
    storage.setItem('technicalQa.pendingTurn.v1', persistedPendingTurnPayload());
    const api = fakeApi([], { available: false, message: 'Service down.' });
    const controller = createTechnicalQaController(api, {
      storage,
      sleep: immediateSleep,
      createId: () => 'unused-thread',
    });

    await controller.cancelActiveTurn();

    expect(api.cancel).toHaveBeenCalledWith(
      { schemaVersion: 1, threadId: 'thread-fixture', turnId: 'turn-fixture' },
      expect.any(AbortSignal),
    );
    expect(activeTurn(controller).state).toMatchObject({
      status: 'cancelled',
      terminal: true,
      outcome: { kind: 'cancelled' },
    });
    expect(storage.getItem('technicalQa.pendingTurn.v1')).toBeNull();
  });

  it('locally abandons a restored pending turn when service is unavailable and backend cancel cannot confirm', async () => {
    const storage = createMemoryStorage();
    storage.setItem('technicalQa.pendingTurn.v1', persistedPendingTurnPayload());
    const api = fakeApi([], { available: false, message: 'Service down.' });
    vi.mocked(api.cancel).mockRejectedValue(new Error('cancel route unavailable'));
    const controller = createTechnicalQaController(api, {
      storage,
      sleep: immediateSleep,
      createId: () => 'unused-thread',
    });
    await controller.initialize();

    await controller.cancelActiveTurn();

    expect(api.events).not.toHaveBeenCalled();
    expect(activeTurn(controller).state).toMatchObject({
      status: 'cancelled',
      terminal: true,
      outcome: { kind: 'cancelled' },
    });
    expect(controller.getSnapshot().serviceMessage).toBe('The restored answer was abandoned locally because the service is unavailable.');
    expect(storage.getItem('technicalQa.pendingTurn.v1')).toBeNull();
  });

  it('backs off repeated default poll failures exponentially up to a cap and resets after a successful event page', async () => {
    const sleepDurations: number[] = [];
    const api = fakeApi([]);
    vi.mocked(api.events)
      .mockRejectedValueOnce(new Error('temporary failure 1'))
      .mockRejectedValueOnce(new Error('temporary failure 2'))
      .mockRejectedValueOnce(new Error('temporary failure 3'))
      .mockRejectedValueOnce(new Error('temporary failure 4'))
      .mockRejectedValueOnce(new Error('temporary failure 5'))
      .mockRejectedValueOnce(new Error('temporary failure 6'))
      .mockRejectedValueOnce(new Error('temporary failure 7'))
      .mockResolvedValueOnce({
        schemaVersion: 1,
        threadId: 'thread-fixture',
        turnId: 'turn-fixture',
        events: [],
        nextCursor: 0,
        terminal: false,
      })
      .mockRejectedValueOnce(new Error('temporary failure after reset'))
      .mockResolvedValueOnce(QA_CLIENT_EVENT_FIXTURES.ecaAnswer);
    const controller = createTechnicalQaController(api, {
      sleep: async (milliseconds) => { sleepDurations.push(milliseconds); },
      createId: () => 'request-1',
    });
    controller.setDraft('Back off and recover');

    await controller.submit();

    expect(sleepDurations).toEqual([750, 1500, 3000, 6000, 12000, 15000, 15000, 750, 750]);
    expect(activeTurn(controller).state.status).toBe('answer');
  });

  it.each([
    ['follow_up', QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp],
    ['refusal', QA_CLIENT_EVENT_FIXTURES.conflictingRefusal],
    ['refusal', QA_CLIENT_EVENT_FIXTURES.forbiddenRefusal],
  ])('retains readable transcript for %s outcomes', async (status, page) => {
    const controller = createTechnicalQaController(fakeApi([page]), { sleep: immediateSleep, createId: () => 'request-1' });
    controller.setDraft('Question requiring a terminal outcome');
    await controller.submit();
    expect(activeTurn(controller).state.status).toBe(status);
    expect(activeTurn(controller).question).toBe('Question requiring a terminal outcome');
  });

  it.each([
    { kind: 'error', code: 'internal_error', message: 'Safe error.', retryable: true } satisfies QaTerminalOutcome,
    { kind: 'cancelled', message: 'Cancelled.' } satisfies QaTerminalOutcome,
  ])('surfaces $kind as a terminal transcript outcome', async (outcome) => {
    const source = QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp;
    const page: QaEventPage = {
      ...source,
      events: source.events.map((event, index) => index === source.events.length - 1
        ? { ...event, payload: { type: 'turn.completed', outcome }, type: 'turn.completed' }
        : event),
    };
    const controller = createTechnicalQaController(fakeApi([page]), { sleep: immediateSleep, createId: () => 'request-1' });
    controller.setDraft('Terminal state');
    await controller.submit();
    expect(activeTurn(controller).state.status).toBe(outcome.kind);
  });

  it('retains thread history, domain, and drafts across selection', async () => {
    const ids = ['thread-key-1', 'request-1', 'thread-key-2'];
    const controller = createTechnicalQaController(fakeApi([QA_CLIENT_EVENT_FIXTURES.luaAnswer]), {
      sleep: immediateSleep,
      createId: () => ids.shift()!,
    });
    controller.setDomain('lua_y3_lualib');
    controller.setDraft('How does the timer API work?');
    await controller.submit();
    const firstKey = controller.getSnapshot().activeThreadKey;
    const secondKey = controller.startNewThread();
    controller.setDraft('Unsaved follow-up draft');
    controller.selectThread(firstKey);
    controller.selectThread(secondKey);

    expect(controller.getSnapshot()).toMatchObject({
      activeThreadKey: secondKey,
      draft: 'Unsaved follow-up draft',
      domain: 'lua_y3_lualib',
    });
    expect(controller.getSnapshot().threads.find((thread) => thread.key === firstKey)?.turns).toHaveLength(1);
  });

  it('keeps the draft and exposes sanitized service state when unavailable', async () => {
    const api = fakeApi([], { available: false, message: 'Service maintenance.' });
    const controller = createTechnicalQaController(api, { createId: () => 'thread-key' });
    await controller.initialize();
    controller.setDraft('Preserve this');
    await controller.submit();

    expect(controller.getSnapshot()).toMatchObject({
      draft: 'Preserve this',
      serviceStatus: 'unavailable',
      serviceMessage: 'Service maintenance.',
    });
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('falls back to a generic unavailable state when health inspection fails', async () => {
    const api = fakeApi([]);
    vi.mocked(api.health).mockRejectedValue(new Error('private endpoint details'));
    const controller = createTechnicalQaController(api, { createId: () => 'thread-key' });

    await controller.initialize();

    expect(controller.getSnapshot()).toMatchObject({
      serviceStatus: 'unavailable',
      serviceMessage: 'Technical QA service is currently unavailable.',
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private endpoint');
  });

  it('ignores empty and concurrent submissions', async () => {
    let resolveSubmit!: (value: QaQuestionAccepted) => void;
    const api = fakeApi([]);
    vi.mocked(api.submit).mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    const controller = createTechnicalQaController(api, { createId: () => 'request-1' });

    await controller.submit();
    expect(api.submit).not.toHaveBeenCalled();
    controller.setDraft('First question');
    const firstSubmission = controller.submit();
    controller.setDraft('Second question');
    await controller.submit();
    expect(api.submit).toHaveBeenCalledOnce();

    controller.dispose();
    resolveSubmit(accepted());
    await firstSubmission;
  });

  it('reuses the current empty thread instead of duplicating history entries', () => {
    const controller = createTechnicalQaController(fakeApi([]), { createId: () => 'thread-key' });

    expect(controller.startNewThread()).toBe('thread-key');
    expect(controller.getSnapshot().threads).toHaveLength(1);
  });

  it('bounds repeated poll failures and reports a sanitized retryable error', async () => {
    const api = fakeApi([]);
    vi.mocked(api.events).mockRejectedValue(new Error('provider secret at C:\\private'));
    const controller = createTechnicalQaController(api, {
      sleep: immediateSleep,
      createId: () => 'request-1',
      maxConsecutivePollFailures: 2,
    });
    controller.setDraft('Question');
    await controller.submit();

    expect(api.events).toHaveBeenCalledTimes(2);
    expect(activeTurn(controller).state.outcome).toEqual({
      kind: 'error',
      code: 'service_unavailable',
      message: 'The answer stream could not be completed. Please try again.',
      retryable: true,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('provider secret');
  });

  it('bounds non-terminal polling and reports a request timeout', async () => {
    const emptyPage: QaEventPage = {
      schemaVersion: 1,
      threadId: 'thread-fixture',
      turnId: 'turn-fixture',
      events: [],
      nextCursor: 0,
      terminal: false,
    };
    const api = fakeApi([emptyPage]);
    const controller = createTechnicalQaController(api, {
      sleep: immediateSleep,
      createId: () => 'request-1',
      maxPollAttempts: 2,
    });
    controller.setDraft('Slow question');

    await controller.submit();

    expect(api.events).toHaveBeenCalledTimes(2);
    expect(activeTurn(controller).state.outcome).toEqual({
      kind: 'error',
      code: 'request_timeout',
      message: 'The answer timed out. Please try again.',
      retryable: true,
    });
  });

  it('requests cancellation for the active identifiers and converges on cancelled', async () => {
    let releasePoll!: (page: QaEventPage) => void;
    const api = fakeApi([]);
    vi.mocked(api.events).mockImplementation(() => new Promise((resolve) => { releasePoll = resolve; }));
    const controller = createTechnicalQaController(api, { sleep: immediateSleep, createId: () => 'request-1' });
    controller.setDraft('Cancel this');
    const submission = controller.submit();
    await vi.waitFor(() => expect(api.events).toHaveBeenCalled());
    await controller.cancelActiveTurn();
    const source = QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp;
    const outcome: QaTerminalOutcome = { kind: 'cancelled', message: 'Cancelled.' };
    releasePoll({
      ...source,
      events: source.events.map((event, index) => index === source.events.length - 1
        ? { ...event, payload: { type: 'turn.completed', outcome }, type: 'turn.completed' }
        : event),
    });
    await submission;

    expect(api.cancel).toHaveBeenCalledWith(
      { schemaVersion: 1, threadId: 'thread-fixture', turnId: 'turn-fixture' },
      expect.any(AbortSignal),
    );
    expect(activeTurn(controller).state.status).toBe('cancelled');
  });

  it('reports a sanitized cancellation failure while leaving polling active', async () => {
    const api = fakeApi([]);
    vi.mocked(api.events).mockImplementation(() => new Promise<QaEventPage>(() => undefined));
    vi.mocked(api.cancel).mockRejectedValue(new Error('raw cancellation failure'));
    const controller = createTechnicalQaController(api, { createId: () => 'request-1' });
    controller.setDraft('Cancel this');
    void controller.submit();
    await vi.waitFor(() => expect(api.events).toHaveBeenCalled());

    await controller.cancelActiveTurn();

    expect(controller.getSnapshot().serviceMessage).toBe('Cancellation could not be confirmed. Please try again.');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('raw cancellation failure');
    controller.dispose();
  });

  it('ignores stale asynchronous completion after disposal', async () => {
    let resolveSubmit!: (value: QaQuestionAccepted) => void;
    const api = fakeApi([]);
    vi.mocked(api.submit).mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    const controller = createTechnicalQaController(api, { createId: () => 'request-1' });
    controller.setDraft('Pending');
    const submission = controller.submit();
    controller.dispose();
    resolveSubmit(accepted());
    await submission;

    expect(api.events).not.toHaveBeenCalled();
  });
});

function file(name: string, type: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  return {
    name, type, size: bytes.byteLength,
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  } as unknown as File;
}

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

function throwingStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: vi.fn(() => { throw new DOMException('Blocked', 'SecurityError'); }),
    setItem: vi.fn(() => { throw new DOMException('Blocked', 'SecurityError'); }),
    removeItem: vi.fn(() => { throw new DOMException('Blocked', 'SecurityError'); }),
  };
}

function persistedPendingTurnPayload(): string {
  return JSON.stringify({
    schemaVersion: 1,
    thread: {
      key: 'thread-key',
      threadId: 'thread-fixture',
      title: 'Restored question',
      createdAt: '2026-08-05T09:00:00.000Z',
      updatedAt: '2026-08-05T09:00:00.000Z',
      turns: [],
    },
    turn: {
      clientRequestId: 'request-1',
      question: 'Restored question',
      domain: 'eca_editor',
      submittedAt: '2026-08-05T09:00:00.000Z',
      attachments: [{ kind: 'log', displayName: 'game.log', decodedByteSize: 123 }],
      state: {
        threadId: 'thread-fixture',
        turnId: 'turn-fixture',
        lastSequence: 0,
        answerText: '',
        terminal: false,
      },
    },
  });
}
