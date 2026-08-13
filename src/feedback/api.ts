import type {
  FeedbackErrorCode,
  FeedbackSessionResponse,
  FeedbackSubmissionAcknowledgement,
  FeedbackSubmissionRequest,
  FeedbackUploadRequest,
  FeedbackUploadResponse,
} from './types';

const DEFAULT_SERVICE_URL = '/api';
const ELECTRON_DEFAULT_SERVICE_URL = 'http://127.0.0.1:8790';
const BUILD_SERVICE_URL = typeof __AGENT_RUNNER_URL__ === 'string' ? __AGENT_RUNNER_URL__ : '';
const SESSION_STORAGE_KEY = 'feedback.session';
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_EXPIRY_SKEW_MS = 5 * 60 * 1000;

const PUBLIC_ERROR_MESSAGES: Record<FeedbackErrorCode, string> = {
  invalid_request: '反馈内容无效，请检查后再提交。',
  invalid_session: '匿名反馈会话已失效，请重试。',
  rate_limited: '反馈提交过于频繁，请稍后再试。',
  service_unavailable: '反馈服务暂时不可用，请稍后重试。',
  internal_error: '反馈未能提交，请稍后重试。',
};

const PUBLIC_ERROR_CODES = new Set<FeedbackErrorCode>(Object.keys(PUBLIC_ERROR_MESSAGES) as FeedbackErrorCode[]);

let memorySession: FeedbackSessionResponse | null = null;

export class FeedbackApiError extends Error {
  readonly code: FeedbackErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: FeedbackErrorCode, status: number, retryable = isRetryableFeedbackError(code)) {
    super(PUBLIC_ERROR_MESSAGES[code]);
    this.name = 'FeedbackApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function getFeedbackSessionId(): string {
  if (typeof window === 'undefined') return memorySession?.sessionId ?? '';
  const cached = readCachedFeedbackSession();
  if (cached) return cached.sessionId;
  return memorySession?.sessionId ?? '';
}

export async function ensureFeedbackSession(signal?: AbortSignal): Promise<FeedbackSessionResponse> {
  const cached = readCachedFeedbackSession();
  if (cached) return cached;
  return bootstrapFeedbackSession(signal);
}

export function clearCachedFeedbackSession(): void {
  memorySession = null;
  try {
    window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Memory state was already cleared.
  }
}

export function getFeedbackServiceBaseUrl(): string {
  const configured = import.meta.env.VITE_AGENT_RUNNER_URL as string | undefined;
  if (configured?.trim()) return configured.trim();
  if (BUILD_SERVICE_URL.trim()) return BUILD_SERVICE_URL.trim();
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') return ELECTRON_DEFAULT_SERVICE_URL;
  return DEFAULT_SERVICE_URL;
}

export function bootstrapFeedbackSession(signal?: AbortSignal): Promise<FeedbackSessionResponse> {
  return requestJson<FeedbackSessionResponse>('/api/feedback/sessions', { method: 'POST', body: { schemaVersion: 1 }, signal, omitSession: true })
    .then(validateSessionResponse);
}

export function uploadFeedbackAttachment(
  request: FeedbackUploadRequest,
  signal?: AbortSignal,
): Promise<FeedbackUploadResponse> {
  return requestJson<unknown>('/api/feedback/uploads', { method: 'POST', body: request, signal })
    .then((payload) => validateUploadResponse(payload, request));
}

export function submitFeedback(
  request: FeedbackSubmissionRequest,
  signal?: AbortSignal,
): Promise<FeedbackSubmissionAcknowledgement> {
  return requestJson<unknown>('/api/feedback/submissions', { method: 'POST', body: request, signal })
    .then(validateAcknowledgement);
}

interface FeedbackRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  omitSession?: boolean;
}

async function requestJson<T>(path: string, options: FeedbackRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const sessionId = options.omitSession ? undefined : (await ensureFeedbackSession(options.signal)).sessionId;
  options.signal?.throwIfAborted();

  if (typeof window !== 'undefined' && window.electronAPI?.feedbackRequest) {
    const pending = window.electronAPI.feedbackRequest({
      path,
      method,
      body: options.body,
      ...(sessionId ? { sessionId } : {}),
    });
    const result = await abortable(pending, options.signal);
    if (!result.success) throw new FeedbackApiError('service_unavailable', 0);
    if (result.status < 200 || result.status >= 300) {
      const error = publicError(result.status, result.payload);
      if (error.code === 'invalid_session') clearCachedFeedbackSession();
      throw error;
    }
    return result.payload as T;
  }

  let response: Response;
  try {
    response = await fetch(joinServiceUrl(getFeedbackServiceBaseUrl(), path), {
      method,
      signal: options.signal,
      headers: {
        ...(sessionId ? { 'X-Feedback-Session': sessionId } : {}),
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new FeedbackApiError('service_unavailable', 0);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = publicError(response.status, payload);
    if (error.code === 'invalid_session') clearCachedFeedbackSession();
    throw error;
  }
  return payload as T;
}

function publicError(status: number, payload: unknown): FeedbackApiError {
  const code = readPublicErrorCode(payload) ?? (status === 429
    ? 'rate_limited'
    : status === 401 || status === 403
      ? 'invalid_session'
      : status === 400
        ? 'invalid_request'
        : status === 503
          ? 'service_unavailable'
          : 'internal_error');
  return new FeedbackApiError(code, status);
}

function readPublicErrorCode(payload: unknown): FeedbackErrorCode | undefined {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.code !== 'string') return undefined;
  return PUBLIC_ERROR_CODES.has(payload.error.code as FeedbackErrorCode)
    ? payload.error.code as FeedbackErrorCode
    : undefined;
}

function validateSessionResponse(payload: FeedbackSessionResponse): FeedbackSessionResponse {
  if (!isRecord(payload)
    || payload.schemaVersion !== 1
    || typeof payload.sessionId !== 'string'
    || !SESSION_PATTERN.test(payload.sessionId)
    || typeof payload.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(payload.expiresAt))) {
    throw new FeedbackApiError('internal_error', 500);
  }
  memorySession = payload;
  try {
    window.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // In-memory session already updated.
  }
  return payload;
}

function validateUploadResponse(payload: unknown, request: FeedbackUploadRequest): FeedbackUploadResponse {
  const allowedKeys = new Set(['schemaVersion', 'uploadId', 'kind', 'displayName', 'mediaType', 'decodedByteSize', 'expiresAt']);
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
    || payload.decodedByteSize !== request.decodedByteSize
    || typeof payload.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(payload.expiresAt))) {
    throw new FeedbackApiError('internal_error', 500);
  }
  return payload as unknown as FeedbackUploadResponse;
}

function validateAcknowledgement(payload: unknown): FeedbackSubmissionAcknowledgement {
  const allowedKeys = new Set(['schemaVersion', 'accepted', 'message']);
  if (!isRecord(payload)
    || Object.keys(payload).length !== allowedKeys.size
    || Object.keys(payload).some((key) => !allowedKeys.has(key))
    || payload.schemaVersion !== 1
    || payload.accepted !== true
    || payload.message !== 'feedback_received') {
    throw new FeedbackApiError('internal_error', 500);
  }
  return payload as unknown as FeedbackSubmissionAcknowledgement;
}

function createSessionId(prefix: string): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createFeedbackClientId(prefix: 'client-upload' | 'client-submission'): string {
  return createSessionId(prefix.replace('-', '_'));
}

function joinServiceUrl(baseUrl: string, apiPath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/g, '');
  const normalizedPath = apiPath.startsWith('/api/') && normalizedBase.endsWith('/api')
    ? apiPath.slice('/api'.length)
    : apiPath;
  return `${normalizedBase}${normalizedPath}`;
}

export function isRetryableFeedbackError(code: FeedbackErrorCode): boolean {
  return code === 'invalid_session' || code === 'rate_limited' || code === 'service_unavailable' || code === 'internal_error';
}

function readCachedFeedbackSession(): FeedbackSessionResponse | null {
  if (isUsableSession(memorySession)) return memorySession;
  memorySession = null;
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (!isRecord(parsed)
      || parsed.schemaVersion !== 1
      || typeof parsed.sessionId !== 'string'
      || typeof parsed.expiresAt !== 'string') {
      window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    const session = parsed as unknown as FeedbackSessionResponse;
    if (!isUsableSession(session)) {
      window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    memorySession = session;
    return session;
  } catch {
    return null;
  }
}

function isUsableSession(session: FeedbackSessionResponse | null): session is FeedbackSessionResponse {
  if (!session || session.schemaVersion !== 1 || !SESSION_PATTERN.test(session.sessionId)) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > SESSION_EXPIRY_SKEW_MS;
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
