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
const DEFAULT_MAX_POLL_ATTEMPTS = 240;
const DEFAULT_MAX_POLL_FAILURES = 3;
const GENERIC_UNAVAILABLE_MESSAGE = 'Technical QA service is currently unavailable.';
const GENERIC_SUBMIT_ERROR = 'The question could not be submitted. Please try again.';
const GENERIC_POLL_ERROR = 'The answer stream could not be completed. Please try again.';

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

export class TechnicalQaController {
  private readonly api: QaControllerApi;
  private readonly listeners = new Set<Listener>();
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly maxConsecutivePollFailures: number;
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
    this.maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    this.maxConsecutivePollFailures = options.maxConsecutivePollFailures ?? DEFAULT_MAX_POLL_FAILURES;
    this.createId = options.createId ?? defaultCreateId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? defaultSleep;
    const thread = createThread(this.createId(), this.now());
    this.state = {
      threads: [thread],
      activeThreadKey: thread.key,
      draft: '',
      domain: 'eca_editor',
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
    if (!run) return;
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
    while (this.isCurrent(run) && attempts < this.maxPollAttempts) {
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
        const nextTurnState = reduceQaEventPage(turn.state, page);
        this.updateTurn(run, nextTurnState);
        if (nextTurnState.terminal) {
          this.finishRun(run);
          return;
        }
      } catch {
        if (!this.isCurrent(run)) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= this.maxConsecutivePollFailures) {
          this.updateTurn(run, terminalError(turn.state, 'service_unavailable', GENERIC_POLL_ERROR));
          this.finishRun(run);
          return;
        }
      }
      try {
        await this.sleep(this.pollIntervalMs, run.abortController.signal);
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
    this.patch({ submitting: false });
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
