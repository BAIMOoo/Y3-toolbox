import { describe, expect, it, vi } from 'vitest';
import { QA_CLIENT_EVENT_FIXTURES } from './fixtures';
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
