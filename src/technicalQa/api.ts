import type {
  QaCancelRequest,
  QaControllerApi,
  QaServiceHealth,
} from './controller';
import {
  buildQaEventPath,
  type QaDiagnosticUploadAccepted,
  type QaDiagnosticUploadRequest,
  type QaEventPage,
  type QaEventRequest,
  type QaPublicErrorCode,
  type QaQuestionAccepted,
  type QaQuestionRequest,
} from './types';

const DEFAULT_SERVICE_URL = '/api';
const ELECTRON_DEFAULT_SERVICE_URL = 'http://127.0.0.1:8790';
const BUILD_SERVICE_URL = typeof __AGENT_RUNNER_URL__ === 'string' ? __AGENT_RUNNER_URL__ : '';
const SESSION_STORAGE_KEY = 'technicalQa.sessionId';
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const GENERIC_UNAVAILABLE_MESSAGE = 'Technical QA service is currently unavailable.';

const PUBLIC_ERROR_MESSAGES: Record<QaPublicErrorCode, string> = {
  invalid_request: 'The Technical QA request was invalid.',
  invalid_cursor: 'The answer stream cursor was invalid.',
  cursor_expired: 'The answer stream expired. Please submit the question again.',
  rate_limited: 'Technical QA is busy. Please try again shortly.',
  retrieval_unavailable: 'Technical QA could not retrieve evidence. Please try again.',
  service_unavailable: GENERIC_UNAVAILABLE_MESSAGE,
  request_timeout: 'The Technical QA request timed out. Please try again.',
  internal_error: 'Technical QA could not complete the request.',
};

const PUBLIC_ERROR_CODES = new Set<QaPublicErrorCode>(Object.keys(PUBLIC_ERROR_MESSAGES) as QaPublicErrorCode[]);

let memorySessionId = '';

export interface QaThreadResponse {
  schemaVersion: 1;
  threadId: string;
  turns: readonly unknown[];
}

export class TechnicalQaApiError extends Error {
  readonly code: QaPublicErrorCode;
  readonly status: number;

  constructor(code: QaPublicErrorCode, status: number) {
    super(PUBLIC_ERROR_MESSAGES[code]);
    this.name = 'TechnicalQaApiError';
    this.code = code;
    this.status = status;
  }
}

export function getTechnicalQaSessionId(): string {
  if (typeof window === 'undefined') return 'test-qa-session-0001';

  try {
    const stored = window.localStorage?.getItem(SESSION_STORAGE_KEY);
    if (stored && SESSION_PATTERN.test(stored)) {
      memorySessionId = stored;
      return stored;
    }
  } catch {
    // Memory fallback keeps the session stable when storage is unavailable.
  }

  if (SESSION_PATTERN.test(memorySessionId)) return memorySessionId;
  memorySessionId = createSessionId();
  try {
    window.localStorage?.setItem(SESSION_STORAGE_KEY, memorySessionId);
  } catch {
    // The in-memory session remains valid for the current renderer lifetime.
  }
  return memorySessionId;
}

export function getTechnicalQaServiceBaseUrl(): string {
  const configured = import.meta.env.VITE_AGENT_RUNNER_URL as string | undefined;
  if (configured?.trim()) return configured.trim();
  if (BUILD_SERVICE_URL.trim()) return BUILD_SERVICE_URL.trim();
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') return ELECTRON_DEFAULT_SERVICE_URL;
  return DEFAULT_SERVICE_URL;
}

export function fetchTechnicalQaHealth(signal?: AbortSignal): Promise<QaServiceHealth> {
  return requestJson<{ schemaVersion: 1; ready: boolean }>('/api/qa/health', { signal }, [503])
    .then((payload) => {
      if (payload.schemaVersion !== 1 || typeof payload.ready !== 'boolean') {
        throw new TechnicalQaApiError('internal_error', 500);
      }
      return payload.ready
        ? { available: true }
        : { available: false, message: GENERIC_UNAVAILABLE_MESSAGE };
    });
}

export function submitTechnicalQaQuestion(
  request: QaQuestionRequest,
  signal?: AbortSignal,
): Promise<QaQuestionAccepted> {
  return requestJson('/api/qa/turns', { method: 'POST', body: request, signal });
}

export function uploadTechnicalQaDiagnostic(
  request: QaDiagnosticUploadRequest,
  signal?: AbortSignal,
): Promise<QaDiagnosticUploadAccepted> {
  return requestJson<unknown>('/api/qa/diagnostic-uploads', { method: 'POST', body: request, signal })
    .then((payload) => validateDiagnosticUploadReceipt(payload, request));
}

export function fetchTechnicalQaThread(threadId: string, signal?: AbortSignal): Promise<QaThreadResponse> {
  return requestJson(`/api/qa/threads/${encodeURIComponent(threadId)}`, { signal });
}

export function fetchTechnicalQaEvents(request: QaEventRequest, signal?: AbortSignal): Promise<QaEventPage> {
  return requestJson(buildQaEventPath(request), { signal });
}

export function cancelTechnicalQaTurn(request: QaCancelRequest, signal?: AbortSignal): Promise<QaEventPage> {
  const path = `/api/qa/threads/${encodeURIComponent(request.threadId)}/turns/${encodeURIComponent(request.turnId)}/cancel`;
  return requestJson(path, { method: 'POST', body: { schemaVersion: request.schemaVersion }, signal });
}

export const technicalQaApi: QaControllerApi = {
  health: fetchTechnicalQaHealth,
  uploadDiagnostic: uploadTechnicalQaDiagnostic,
  submit: submitTechnicalQaQuestion,
  events: fetchTechnicalQaEvents,
  async cancel(request, signal) {
    await cancelTechnicalQaTurn(request, signal);
  },
};

interface QaRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

async function requestJson<T>(
  path: string,
  options: QaRequestOptions = {},
  acceptedErrorStatuses: readonly number[] = [],
): Promise<T> {
  const method = options.method ?? 'GET';
  const sessionId = getTechnicalQaSessionId();
  options.signal?.throwIfAborted();

  if (typeof window !== 'undefined' && window.electronAPI?.technicalQaRequest) {
    const pending = window.electronAPI.technicalQaRequest({
      path,
      method,
      body: options.body,
      sessionId,
    });
    const result = await abortable(pending, options.signal);
    if (!result.success) throw new TechnicalQaApiError('service_unavailable', 0);
    if (!isAcceptedStatus(result.status, acceptedErrorStatuses)) {
      throw publicError(result.status, result.payload);
    }
    return result.payload as T;
  }

  let response: Response;
  try {
    response = await fetch(joinServiceUrl(getTechnicalQaServiceBaseUrl(), path), {
      method,
      signal: options.signal,
      headers: {
        'X-QA-Session': sessionId,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new TechnicalQaApiError('service_unavailable', 0);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !acceptedErrorStatuses.includes(response.status)) {
    throw publicError(response.status, payload);
  }
  return payload as T;
}

function createSessionId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return `qa_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function joinServiceUrl(baseUrl: string, apiPath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/g, '');
  const normalizedPath = apiPath.startsWith('/api/') && normalizedBase.endsWith('/api')
    ? apiPath.slice('/api'.length)
    : apiPath;
  return `${normalizedBase}${normalizedPath}`;
}

function isAcceptedStatus(status: number, acceptedErrorStatuses: readonly number[]): boolean {
  return (status >= 200 && status < 300) || acceptedErrorStatuses.includes(status);
}

function publicError(status: number, payload: unknown): TechnicalQaApiError {
  const code = readPublicErrorCode(payload) ?? (status === 429
    ? 'rate_limited'
    : status === 503
      ? 'service_unavailable'
      : status === 504
        ? 'request_timeout'
        : 'internal_error');
  return new TechnicalQaApiError(code, status);
}

function readPublicErrorCode(payload: unknown): QaPublicErrorCode | undefined {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.code !== 'string') return undefined;
  return PUBLIC_ERROR_CODES.has(payload.error.code as QaPublicErrorCode)
    ? payload.error.code as QaPublicErrorCode
    : undefined;
}

function validateDiagnosticUploadReceipt(
  payload: unknown,
  request: QaDiagnosticUploadRequest,
): QaDiagnosticUploadAccepted {
  const allowedKeys = new Set([
    'schemaVersion', 'uploadId', 'kind', 'displayName', 'mediaType', 'decodedByteSize', 'expiresAt',
  ]);
  if (!isRecord(payload)
    || Object.keys(payload).length !== allowedKeys.size
    || Object.keys(payload).some((key) => !allowedKeys.has(key))
    || payload.schemaVersion !== 1
    || typeof payload.uploadId !== 'string'
    || !SESSION_PATTERN.test(payload.uploadId)
    || payload.kind !== request.kind
    || payload.displayName !== request.displayName
    || payload.mediaType !== request.mediaType
    || !Number.isSafeInteger(payload.decodedByteSize)
    || Number(payload.decodedByteSize) < 1
    || Number(payload.decodedByteSize) > request.decodedByteSize
    || (request.kind === 'screenshot' && payload.decodedByteSize !== request.decodedByteSize)
    || typeof payload.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(payload.expiresAt))
    || Date.parse(payload.expiresAt) <= Date.now()) {
    throw new TechnicalQaApiError('internal_error', 500);
  }
  return payload as unknown as QaDiagnosticUploadAccepted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
