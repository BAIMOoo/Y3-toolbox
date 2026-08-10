import { createInitialQaTurnState, reduceQaEventPage, type QaTurnState } from './reducer';
import {
  prepareQaAttachments,
  toQaAttachmentSummary,
  type PreparedQaAttachment,
  type QaAttachmentSummary,
} from './attachments';
import type {
  QaDiagnosticUploadAccepted,
  QaDiagnosticUploadRequest,
  QaDomain,
  QaEventPage,
  QaEventRequest,
  QaPublicErrorCode,
  QaQuestionAccepted,
  QaQuestionRequest,
} from './types';

export type QaServiceStatus = 'checking' | 'ready' | 'unavailable';

export interface QaServiceHealth {
  available: boolean;
  message?: string;
}

export interface QaCancelRequest {
  schemaVersion: 1;
  threadId: string;
  turnId: string;
}

export interface QaControllerApi {
  health(signal?: AbortSignal): Promise<QaServiceHealth>;
  uploadDiagnostic(request: QaDiagnosticUploadRequest, signal?: AbortSignal): Promise<QaDiagnosticUploadAccepted>;
  submit(request: QaQuestionRequest, signal?: AbortSignal): Promise<QaQuestionAccepted>;
  events(request: QaEventRequest, signal?: AbortSignal): Promise<QaEventPage>;
  cancel(request: QaCancelRequest, signal?: AbortSignal): Promise<void>;
}

export interface QaTranscriptTurn {
  clientRequestId: string;
  question: string;
  domain: QaDomain;
  submittedAt: string;
  attachments?: QaAttachmentSummary[];
  state: QaTurnState;
}

export interface QaThreadSession {
  key: string;
  threadId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: QaTranscriptTurn[];
}

export interface TechnicalQaState {
  threads: QaThreadSession[];
  activeThreadKey: string;
  draft: string;
  domain: QaDomain;
  serviceStatus: QaServiceStatus;
  serviceMessage?: string;
  submitting: boolean;
  preparingAttachments: boolean;
  pendingAttachments: PreparedQaAttachment[];
  attachmentError?: string;
  uploadProgress?: { completed: number; total: number };
}

export interface TechnicalQaControllerOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  maxConsecutivePollFailures?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  createId?: () => string;
  now?: () => string;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

type Listener = () => void;

interface ActiveRun {
  id: number;
  threadKey: string;
  clientRequestId: string;
  abortController: AbortController;
}

interface PendingSubmitAttempt {
  fingerprint: string;
  clientRequestId: string;
}

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_MAX_POLL_BACKOFF_MS = 15_000;
const PENDING_TURN_STORAGE_KEY = 'technicalQa.pendingTurn.v1';
const GENERIC_UNAVAILABLE_MESSAGE = 'Technical QA service is currently unavailable.';
const GENERIC_SUBMIT_ERROR = 'The question could not be submitted. Please try again.';
const GENERIC_POLL_ERROR = 'The answer stream could not be completed. Please try again.';
const POLL_RECONNECTING_MESSAGE = '回答连接中断，正在重试…';
const RESTORED_TURN_ABANDONED_MESSAGE = 'The restored answer was abandoned locally because the service is unavailable.';

interface PersistedPendingTurnRecord {
  schemaVersion: 1;
  thread: {
    key: string;
    threadId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  turn: {
    clientRequestId: string;
    question: string;
    domain: QaDomain;
    submittedAt: string;
    attachments?: QaAttachmentSummary[];
    state: {
      threadId: string;
      turnId: string;
      lastSequence: number;
      answerText: string;
    };
  };
}

function defaultCreateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = globalThis.setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function createThread(key: string, now: string): QaThreadSession {
  return { key, title: 'New question', createdAt: now, updatedAt: now, turns: [] };
}

function terminalError(state: QaTurnState, code: QaPublicErrorCode, message: string): QaTurnState {
  return {
    ...state,
    status: 'error',
    terminal: true,
    outcome: { kind: 'error', code, message, retryable: true },
  };
}

function terminalCancelled(state: QaTurnState): QaTurnState {
  return {
    ...state,
    status: 'cancelled',
    terminal: true,
    outcome: { kind: 'cancelled', message: 'Cancelled.' },
  };
}

export class TechnicalQaController {
  private readonly api: QaControllerApi;
  private readonly listeners = new Set<Listener>();
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts?: number;
  private readonly maxConsecutivePollFailures?: number;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private state: TechnicalQaState;
  private activeRun?: ActiveRun;
  private pendingSubmitAttempt?: PendingSubmitAttempt;
  private runSequence = 0;
  private initialized = false;
  private disposed = false;

  constructor(api: QaControllerApi, options: TechnicalQaControllerOptions = {}) {
    this.api = api;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = options.maxPollAttempts;
    this.maxConsecutivePollFailures = options.maxConsecutivePollFailures;
    this.storage = options.storage ?? getDefaultStorage();
    this.createId = options.createId ?? defaultCreateId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? defaultSleep;
    const thread = createThread(this.createId(), this.now());
    const restored = readPersistedPendingTurn(this.storage);
    this.state = {
      threads: restored ? [restored.thread] : [thread],
      activeThreadKey: restored ? restored.thread.key : thread.key,
      draft: '',
      domain: restored ? restored.turn.domain : 'eca_editor',
      serviceStatus: 'checking',
      submitting: false,
      preparingAttachments: false,
      pendingAttachments: [],
    };
  }

  getSnapshot = (): TechnicalQaState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize = async (): Promise<void> => {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    await this.refreshHealth();
  };

  refreshHealth = async (): Promise<void> => {
    if (this.disposed) return;
    this.patch({ serviceStatus: 'checking', serviceMessage: undefined });
    try {
      const health = await this.api.health();
      if (this.disposed) return;
      this.patch({
        serviceStatus: health.available ? 'ready' : 'unavailable',
        serviceMessage: health.available ? undefined : health.message || GENERIC_UNAVAILABLE_MESSAGE,
      });
      if (health.available) this.resumePendingTurn();
    } catch {
      if (!this.disposed) {
        this.patch({ serviceStatus: 'unavailable', serviceMessage: GENERIC_UNAVAILABLE_MESSAGE });
      }
    }
  };

  setDraft = (draft: string): void => {
    if (draft !== this.state.draft) this.pendingSubmitAttempt = undefined;
    this.patch({ draft });
  };

  setDomain = (domain: QaDomain): void => {
    if (domain !== this.state.domain) this.pendingSubmitAttempt = undefined;
    this.patch({ domain });
  };

  addAttachments = async (files: readonly File[]): Promise<void> => {
    if (files.length === 0 || this.state.preparingAttachments || this.state.submitting || this.activeRun) return;
    this.pendingSubmitAttempt = undefined;
    this.patch({ attachmentError: undefined, preparingAttachments: true });
    try {
      const prepared = await prepareQaAttachments(files, this.state.pendingAttachments, this.createId);
      this.patch({ pendingAttachments: [...this.state.pendingAttachments, ...prepared], preparingAttachments: false });
    } catch (error) {
      this.patch({
        attachmentError: error instanceof Error ? error.message : '附件无法读取。',
        preparingAttachments: false,
      });
    }
  };

  removeAttachment = (clientUploadId: string): void => {
    if (this.state.preparingAttachments || this.state.submitting || this.activeRun) return;
    this.pendingSubmitAttempt = undefined;
    this.patch({
      pendingAttachments: this.state.pendingAttachments.filter(
        (attachment) => attachment.clientUploadId !== clientUploadId,
      ),
      attachmentError: undefined,
    });
  };

  selectThread = (threadKey: string): void => {
    if (this.state.threads.some((thread) => thread.key === threadKey)) {
      if (threadKey !== this.state.activeThreadKey) this.pendingSubmitAttempt = undefined;
      this.patch({ activeThreadKey: threadKey });
    }
  };

  startNewThread = (): string => {
    this.pendingSubmitAttempt = undefined;
    const existingEmpty = this.state.threads.find((thread) => thread.turns.length === 0);
    if (existingEmpty) {
      this.patch({ activeThreadKey: existingEmpty.key, draft: '' });
      return existingEmpty.key;
    }
    const thread = createThread(this.createId(), this.now());
    this.patch({ threads: [thread, ...this.state.threads], activeThreadKey: thread.key, draft: '' });
    return thread.key;
  };

  submit = async (): Promise<void> => {
    const question = this.state.draft.trim();
    if (
      !question
      || this.state.preparingAttachments
      || this.state.submitting
      || this.activeRun
      || this.state.serviceStatus === 'unavailable'
    ) return;

    const thread = this.activeThread();
    const fingerprint = createSubmitFingerprint(thread, question, this.state.domain, this.state.pendingAttachments);
    const clientRequestId = this.pendingSubmitAttempt?.fingerprint === fingerprint
      ? this.pendingSubmitAttempt.clientRequestId
      : this.createId();
    this.pendingSubmitAttempt = { fingerprint, clientRequestId };
    const run: ActiveRun = {
      id: ++this.runSequence,
      threadKey: thread.key,
      clientRequestId,
      abortController: new AbortController(),
    };
    this.activeRun = run;
    const attachments = this.state.pendingAttachments;
    this.patch({
      submitting: true,
      serviceMessage: undefined,
      attachmentError: undefined,
      uploadProgress: attachments.length > 0 ? { completed: 0, total: attachments.length } : undefined,
    });

    let uploadsCompleted = attachments.length === 0;
    let submitStarted = false;
    try {
      const diagnosticUploadIds: string[] = [];
      for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index]!;
        if (attachment.uploadId) {
          diagnosticUploadIds.push(attachment.uploadId);
          this.patch({ uploadProgress: { completed: index + 1, total: attachments.length } });
          continue;
        }
        this.setAttachmentStatus(attachment.clientUploadId, 'uploading');
        const uploaded = await this.api.uploadDiagnostic(stripAttachmentState(attachment), run.abortController.signal);
        if (!this.isCurrent(run)) return;
        diagnosticUploadIds.push(uploaded.uploadId);
        this.cacheAttachmentUpload(attachment.clientUploadId, uploaded.uploadId);
        this.patch({ uploadProgress: { completed: index + 1, total: attachments.length } });
      }
      uploadsCompleted = true;

      const request: QaQuestionRequest = {
        schemaVersion: 1,
        clientRequestId,
        ...(thread.threadId ? { threadId: thread.threadId } : {}),
        question,
        scope: { product: 'y3_editor', editorVersion: '2.0', domain: this.state.domain },
        ...(diagnosticUploadIds.length > 0 ? { diagnosticUploadIds } : {}),
      };
      submitStarted = true;
      const accepted = await this.api.submit(request, run.abortController.signal);
      if (!this.isCurrent(run)) return;
      this.pendingSubmitAttempt = undefined;
      const turn: QaTranscriptTurn = {
        clientRequestId,
        question,
        domain: request.scope.domain,
        submittedAt: accepted.acceptedAt,
        attachments: attachments.map(toQaAttachmentSummary),
        state: {
          ...createInitialQaTurnState(),
          threadId: accepted.threadId,
          turnId: accepted.turnId,
          status: 'loading',
        },
      };
      this.updateThread(run.threadKey, (current) => ({
        ...current,
        threadId: accepted.threadId,
        title: current.turns.length === 0 ? question : current.title,
        updatedAt: accepted.acceptedAt,
        turns: [...current.turns, turn],
      }));
      this.persistPendingTurn(turn);
      this.patch({ draft: '', submitting: false, pendingAttachments: [], uploadProgress: undefined });
      await this.poll(run, accepted.threadId, accepted.turnId);
    } catch (error) {
      if (!this.isCurrent(run)) return;
      const invalidReceipt = submitStarted && hasPublicErrorCode(error, 'invalid_request');
      if (invalidReceipt) this.pendingSubmitAttempt = undefined;
      this.patch({
        submitting: false,
        serviceMessage: uploadsCompleted ? GENERIC_SUBMIT_ERROR : undefined,
        attachmentError: uploadsCompleted ? undefined : '附件上传失败，请检查文件后重试。',
        uploadProgress: undefined,
        pendingAttachments: this.state.pendingAttachments.map((attachment) => ({
          ...attachment,
          ...(invalidReceipt ? { clientUploadId: this.createId(), uploadId: undefined } : {}),
          status: invalidReceipt ? 'pending' : attachment.uploadId ? 'uploaded' : uploadsCompleted ? 'pending' : 'error',
        })),
      });
      this.finishRun(run);
    }
  };

  cancelActiveTurn = async (): Promise<void> => {
    const run = this.activeRun;
    if (!run) {
      await this.cancelRestoredPendingTurn();
      return;
    }
    const turn = this.findTurn(run);
    if (!turn?.state.threadId || !turn.state.turnId) {
      run.abortController.abort();
      this.activeRun = undefined;
      this.patch({
        submitting: false,
        serviceMessage: undefined,
        attachmentError: undefined,
        uploadProgress: undefined,
        pendingAttachments: this.state.pendingAttachments.map((attachment) => ({
          ...attachment,
          status: attachment.uploadId ? 'uploaded' : 'pending',
        })),
      });
      safeRemove(this.storage, PENDING_TURN_STORAGE_KEY);
      return;
    }
    try {
      await this.api.cancel({
        schemaVersion: 1,
        threadId: turn.state.threadId,
        turnId: turn.state.turnId,
      }, run.abortController.signal);
    } catch {
      if (this.isCurrent(run)) this.patch({ serviceMessage: 'Cancellation could not be confirmed. Please try again.' });
    }
  };

  dispose = (): void => {
    this.disposed = true;
    this.activeRun?.abortController.abort();
    this.activeRun = undefined;
    this.listeners.clear();
  };

  private async poll(run: ActiveRun, threadId: string, turnId: string): Promise<void> {
    let attempts = 0;
    let consecutiveFailures = 0;
    while (this.isCurrent(run) && (this.maxPollAttempts === undefined || attempts < this.maxPollAttempts)) {
      const turn = this.findTurn(run);
      if (!turn || turn.state.terminal) {
        this.finishRun(run);
        return;
      }
      attempts += 1;
      try {
        const page = await this.api.events({
          schemaVersion: 1,
          threadId,
          turnId,
          after: turn.state.lastSequence,
        }, run.abortController.signal);
        if (!this.isCurrent(run)) return;
        consecutiveFailures = 0;
        if (this.state.serviceMessage === POLL_RECONNECTING_MESSAGE) this.patch({ serviceMessage: undefined });
        const nextTurnState = reduceQaEventPage(turn.state, page);
        this.updateTurn(run, nextTurnState);
        if (nextTurnState.terminal) {
          this.finishRun(run);
          return;
        }
      } catch (error) {
        if (!this.isCurrent(run)) return;
        const terminalCode = terminalPollErrorCode(error);
        if (terminalCode) {
          this.updateTurn(run, terminalError(turn.state, terminalCode, terminalPollErrorMessage(terminalCode)));
          this.finishRun(run);
          return;
        }
        consecutiveFailures += 1;
        if (
          this.maxConsecutivePollFailures !== undefined
          && consecutiveFailures >= this.maxConsecutivePollFailures
        ) {
          this.updateTurn(run, terminalError(turn.state, 'service_unavailable', GENERIC_POLL_ERROR));
          this.finishRun(run);
          return;
        }
        if (this.state.serviceMessage !== POLL_RECONNECTING_MESSAGE) {
          this.patch({ serviceMessage: POLL_RECONNECTING_MESSAGE });
        }
      }
      try {
        const delay = consecutiveFailures === 0
          ? this.pollIntervalMs
          : Math.min(
            this.pollIntervalMs * (2 ** Math.max(0, consecutiveFailures - 1)),
            DEFAULT_MAX_POLL_BACKOFF_MS,
          );
        await this.sleep(delay, run.abortController.signal);
      } catch {
        return;
      }
    }

    if (this.isCurrent(run)) {
      const turn = this.findTurn(run);
      if (turn && !turn.state.terminal) {
        this.updateTurn(run, terminalError(turn.state, 'request_timeout', 'The answer timed out. Please try again.'));
      }
      this.finishRun(run);
    }
  }

  private activeThread(): QaThreadSession {
    return this.state.threads.find((thread) => thread.key === this.state.activeThreadKey) ?? this.state.threads[0]!;
  }

  private findTurn(run: ActiveRun): QaTranscriptTurn | undefined {
    return this.state.threads
      .find((thread) => thread.key === run.threadKey)
      ?.turns.find((turn) => turn.clientRequestId === run.clientRequestId);
  }

  private updateTurn(run: ActiveRun, state: QaTurnState): void {
    this.updateThread(run.threadKey, (thread) => ({
      ...thread,
      updatedAt: this.now(),
      turns: thread.turns.map((turn) => turn.clientRequestId === run.clientRequestId ? { ...turn, state } : turn),
    }));
    const turn = this.findTurn(run);
    if (turn) this.persistPendingTurn(turn);
  }

  private setAttachmentStatus(clientUploadId: string, status: PreparedQaAttachment['status']): void {
    this.patch({
      pendingAttachments: this.state.pendingAttachments.map((attachment) => (
        attachment.clientUploadId === clientUploadId ? { ...attachment, status } : attachment
      )),
    });
  }

  private cacheAttachmentUpload(clientUploadId: string, uploadId: string): void {
    this.patch({
      pendingAttachments: this.state.pendingAttachments.map((attachment) => (
        attachment.clientUploadId === clientUploadId ? { ...attachment, uploadId, status: 'uploaded' } : attachment
      )),
    });
  }

  private updateThread(threadKey: string, update: (thread: QaThreadSession) => QaThreadSession): void {
    this.patch({
      threads: this.state.threads.map((thread) => thread.key === threadKey ? update(thread) : thread),
    });
  }

  private isCurrent(run: ActiveRun): boolean {
    return !this.disposed && this.activeRun?.id === run.id;
  }

  private finishRun(run: ActiveRun): void {
    if (!this.isCurrent(run)) return;
    this.activeRun = undefined;
    this.patch({
      submitting: false,
      serviceMessage: this.state.serviceMessage === POLL_RECONNECTING_MESSAGE ? undefined : this.state.serviceMessage,
    });
  }

  private resumePendingTurn(): void {
    if (this.disposed || this.activeRun || this.state.serviceStatus !== 'ready') return;
    for (const thread of this.state.threads) {
      const turn = thread.turns.at(-1);
      if (!turn || turn.state.terminal || !turn.state.threadId || !turn.state.turnId) continue;
      const run: ActiveRun = {
        id: ++this.runSequence,
        threadKey: thread.key,
        clientRequestId: turn.clientRequestId,
        abortController: new AbortController(),
      };
      this.activeRun = run;
      this.patch({ submitting: false });
      void this.poll(run, turn.state.threadId, turn.state.turnId);
      return;
    }
  }

  private persistPendingTurn(turn: QaTranscriptTurn): void {
    if (!turn.state.threadId || !turn.state.turnId || turn.state.terminal) {
      safeRemove(this.storage, PENDING_TURN_STORAGE_KEY);
      return;
    }
    const thread = this.state.threads.find((candidate) => candidate.key === this.activeThreadKeyForTurn(turn));
    if (!thread) return;
    const payload: PersistedPendingTurnRecord = {
      schemaVersion: 1,
      thread: {
        key: thread.key,
        threadId: thread.threadId ?? turn.state.threadId,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      },
      turn: {
        clientRequestId: turn.clientRequestId,
        question: turn.question,
        domain: turn.domain,
        submittedAt: turn.submittedAt,
        ...(turn.attachments ? { attachments: turn.attachments } : {}),
        state: {
          threadId: turn.state.threadId,
          turnId: turn.state.turnId,
          lastSequence: turn.state.lastSequence,
          answerText: turn.state.answerText,
        },
      },
    };
    safeSet(this.storage, PENDING_TURN_STORAGE_KEY, JSON.stringify(payload));
  }

  private activeThreadKeyForTurn(turn: QaTranscriptTurn): string | undefined {
    return this.state.threads.find((thread) => (
      thread.turns.some((candidate) => candidate.clientRequestId === turn.clientRequestId)
    ))?.key;
  }

  private async cancelRestoredPendingTurn(): Promise<void> {
    const target = this.findPendingTurnWithIdentifiers();
    if (!target) return;
    const { thread, turn } = target;
    const cancelled = terminalCancelled(turn.state);
    try {
      await this.api.cancel({
        schemaVersion: 1,
        threadId: turn.state.threadId!,
        turnId: turn.state.turnId!,
      }, new AbortController().signal);
      this.updateStoredTurn(thread.key, turn.clientRequestId, cancelled);
      safeRemove(this.storage, PENDING_TURN_STORAGE_KEY);
    } catch {
      this.updateStoredTurn(thread.key, turn.clientRequestId, cancelled);
      safeRemove(this.storage, PENDING_TURN_STORAGE_KEY);
      this.patch({ serviceMessage: RESTORED_TURN_ABANDONED_MESSAGE });
    }
  }

  private findPendingTurnWithIdentifiers(): { thread: QaThreadSession; turn: QaTranscriptTurn } | undefined {
    for (const thread of this.state.threads) {
      const turn = thread.turns.at(-1);
      if (turn && !turn.state.terminal && turn.state.threadId && turn.state.turnId) return { thread, turn };
    }
    return undefined;
  }

  private updateStoredTurn(threadKey: string, clientRequestId: string, state: QaTurnState): void {
    this.updateThread(threadKey, (thread) => ({
      ...thread,
      updatedAt: this.now(),
      turns: thread.turns.map((turn) => turn.clientRequestId === clientRequestId ? { ...turn, state } : turn),
    }));
  }

  private patch(patch: Partial<TechnicalQaState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function hasPublicErrorCode(error: unknown, code: QaPublicErrorCode): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}

function terminalPollErrorCode(error: unknown): QaPublicErrorCode | undefined {
  for (const code of [
    'invalid_request',
    'invalid_cursor',
    'cursor_expired',
    'retrieval_unavailable',
    'request_timeout',
  ] as const) {
    if (hasPublicErrorCode(error, code)) return code;
  }
  return undefined;
}

function terminalPollErrorMessage(code: QaPublicErrorCode): string {
  switch (code) {
    case 'invalid_request':
      return 'The Technical QA request was invalid. Please submit it again.';
    case 'invalid_cursor':
      return 'The answer stream cursor was invalid. Please submit the question again.';
    case 'cursor_expired':
      return 'The answer stream expired. Please submit the question again.';
    case 'retrieval_unavailable':
      return 'Technical QA could not retrieve evidence. Please try again.';
    case 'request_timeout':
      return 'The Technical QA request timed out. Please try again.';
    default:
      return GENERIC_POLL_ERROR;
  }
}

function createSubmitFingerprint(
  thread: QaThreadSession,
  question: string,
  domain: QaDomain,
  attachments: readonly PreparedQaAttachment[],
): string {
  return JSON.stringify({
    threadKey: thread.key,
    threadId: thread.threadId ?? null,
    question,
    domain,
    attachments: attachments.map((attachment) => attachment.clientUploadId),
  });
}

function getDefaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readPersistedPendingTurn(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): { thread: QaThreadSession; turn: QaTranscriptTurn } | undefined {
  try {
    const raw = safeGet(storage, PENDING_TURN_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    const restored = parsePersistedPendingTurn(parsed);
    if (!restored) {
      safeRemove(storage, PENDING_TURN_STORAGE_KEY);
      return undefined;
    }
    return restored;
  } catch {
    safeRemove(storage, PENDING_TURN_STORAGE_KEY);
    return undefined;
  }
}

function parsePersistedPendingTurn(value: unknown): { thread: QaThreadSession; turn: QaTranscriptTurn } | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.thread) || !isRecord(value.turn)) {
    return undefined;
  }
  const { thread, turn } = value;
  if (
    !isSafeIdentifier(thread.key)
    || !isSafeIdentifier(thread.threadId)
    || !isSafeDisplayString(thread.title)
    || !isValidTimestamp(thread.createdAt)
    || !isValidTimestamp(thread.updatedAt)
    || !isSafeIdentifier(turn.clientRequestId)
    || !isSafeDisplayString(turn.question)
    || !isQaDomain(turn.domain)
    || !isValidTimestamp(turn.submittedAt)
    || !isRecord(turn.state)
    || !isSafeIdentifier(turn.state.threadId)
    || !isSafeIdentifier(turn.state.turnId)
    || !Number.isInteger(turn.state.lastSequence)
    || Number(turn.state.lastSequence) < 0
    || typeof turn.state.answerText !== 'string'
    || turn.state.answerText.length > 200_000
  ) {
    return undefined;
  }

  const attachments = parseAttachmentSummaries(turn.attachments);
  if (turn.attachments !== undefined && !attachments) return undefined;

  const state: QaTurnState = {
    ...createInitialQaTurnState(),
    threadId: turn.state.threadId,
    turnId: turn.state.turnId,
    status: turn.state.answerText ? 'streaming' : 'loading',
    answerText: turn.state.answerText,
    lastSequence: Number(turn.state.lastSequence),
  };
  const restoredTurn: QaTranscriptTurn = {
    clientRequestId: turn.clientRequestId,
    question: turn.question,
    domain: turn.domain,
    submittedAt: turn.submittedAt,
    ...(attachments ? { attachments } : {}),
    state,
  };
  return {
    thread: {
      key: thread.key,
      threadId: thread.threadId,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      turns: [restoredTurn],
    },
    turn: restoredTurn,
  };
}

function safeGet(storage: Pick<Storage, 'getItem'> | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Pick<Storage, 'setItem'> | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Persistence is best-effort; polling remains authoritative.
  }
}

function safeRemove(storage: Pick<Storage, 'removeItem'> | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage may be blocked by browser policy.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isQaDomain(value: unknown): value is QaDomain {
  return value === 'eca_editor' || value === 'lua_y3_lualib';
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !hasControlCharacter(value);
}

function isSafeDisplayString(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4_000
    && !hasControlCharacter(value);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function parseAttachmentSummaries(value: unknown): QaAttachmentSummary[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5) return undefined;
  const attachments: QaAttachmentSummary[] = [];
  for (const attachment of value) {
    if (
      !isRecord(attachment)
      || (attachment.kind !== 'log' && attachment.kind !== 'trace' && attachment.kind !== 'screenshot')
      || !isSafeDisplayString(attachment.displayName)
      || !Number.isInteger(attachment.decodedByteSize)
      || Number(attachment.decodedByteSize) < 0
    ) {
      return undefined;
    }
    attachments.push({
      kind: attachment.kind,
      displayName: attachment.displayName,
      decodedByteSize: Number(attachment.decodedByteSize),
    });
  }
  return attachments;
}

function stripAttachmentState(attachment: PreparedQaAttachment): QaDiagnosticUploadRequest {
  return {
    schemaVersion: attachment.schemaVersion,
    clientUploadId: attachment.clientUploadId,
    kind: attachment.kind,
    displayName: attachment.displayName,
    mediaType: attachment.mediaType,
    decodedByteSize: attachment.decodedByteSize,
    contentBase64: attachment.contentBase64,
  };
}

export function createTechnicalQaController(
  api: QaControllerApi,
  options?: TechnicalQaControllerOptions,
): TechnicalQaController {
  return new TechnicalQaController(api, options);
}
