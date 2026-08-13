// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../types/electron';
import { clearCachedFeedbackSession, FeedbackApiError, getFeedbackSessionId, submitFeedback, uploadFeedbackAttachment } from './api';
import type { FeedbackSubmissionRequest, FeedbackUploadRequest } from './types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  clearCachedFeedbackSession();
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  delete window.electronAPI;
});

describe('Feedback API transport', () => {
  it('uses the Electron feedback bridge with only feedback session semantics', async () => {
    const feedbackRequest = vi.fn<NonNullable<ElectronAPI['feedbackRequest']>>()
      .mockResolvedValueOnce({ success: true, status: 200, payload: { schemaVersion: 1, sessionId: 'feedback-session', expiresAt: '2099-08-11T10:00:00.000Z' } })
      .mockResolvedValueOnce({ success: true, status: 200, payload: { schemaVersion: 1, accepted: true, message: 'feedback_received' } });
    window.electronAPI = { feedbackRequest } as unknown as ElectronAPI;
    window.localStorage.setItem('feedback.sessionId', 'fabricated-local-storage-session');

    const request = featureRequest();
    await expect(submitFeedback(request)).resolves.toEqual({ schemaVersion: 1, accepted: true, message: 'feedback_received' });

    expect(feedbackRequest).toHaveBeenNthCalledWith(1, {
      path: '/api/feedback/sessions',
      method: 'POST',
      body: { schemaVersion: 1 },
    });
    expect(feedbackRequest).toHaveBeenNthCalledWith(2, {
      path: '/api/feedback/submissions',
      method: 'POST',
      body: request,
      sessionId: 'feedback-session',
    });
    expect(JSON.stringify(feedbackRequest.mock.calls)).not.toMatch(/ownerToken|X-QA-Session|qa/i);
  });

  it('reuses server-issued sessions from sessionStorage until near expiry without localStorage fallback', async () => {
    const feedbackRequest = vi.fn<NonNullable<ElectronAPI['feedbackRequest']>>()
      .mockResolvedValueOnce({ success: true, status: 200, payload: { schemaVersion: 1, sessionId: 'server-session', expiresAt: '2099-08-11T10:00:00.000Z' } })
      .mockResolvedValue({ success: true, status: 200, payload: { schemaVersion: 1, accepted: true, message: 'feedback_received' } });
    window.electronAPI = { feedbackRequest } as unknown as ElectronAPI;

    await submitFeedback(featureRequest('client-submission-1'));
    await submitFeedback(featureRequest('client-submission-2'));

    expect(feedbackRequest.mock.calls.map((call) => call[0].path)).toEqual([
      '/api/feedback/sessions',
      '/api/feedback/submissions',
      '/api/feedback/submissions',
    ]);
    expect(getFeedbackSessionId()).toBe('server-session');
    expect(window.localStorage.getItem('feedback.sessionId')).toBeNull();
  });

  it('clears invalid server sessions so the next retry bootstraps a fresh session', async () => {
    const feedbackRequest = vi.fn<NonNullable<ElectronAPI['feedbackRequest']>>()
      .mockResolvedValueOnce({ success: true, status: 200, payload: { schemaVersion: 1, sessionId: 'expired-session', expiresAt: '2099-08-11T10:00:00.000Z' } })
      .mockResolvedValueOnce({ success: true, status: 401, payload: { error: { code: 'invalid_session' } } })
      .mockResolvedValueOnce({ success: true, status: 200, payload: { schemaVersion: 1, sessionId: 'fresh-session', expiresAt: '2099-08-11T10:00:00.000Z' } })
      .mockResolvedValueOnce({ success: true, status: 200, payload: { schemaVersion: 1, accepted: true, message: 'feedback_received' } });
    window.electronAPI = { feedbackRequest } as unknown as ElectronAPI;

    await expect(submitFeedback(featureRequest('client-submission-invalid'))).rejects.toMatchObject({ code: 'invalid_session' });
    await expect(submitFeedback(featureRequest('client-submission-retry'))).resolves.toEqual({ schemaVersion: 1, accepted: true, message: 'feedback_received' });

    expect(feedbackRequest.mock.calls.map((call) => [call[0].path, call[0].sessionId])).toEqual([
      ['/api/feedback/sessions', undefined],
      ['/api/feedback/submissions', 'expired-session'],
      ['/api/feedback/sessions', undefined],
      ['/api/feedback/submissions', 'fresh-session'],
    ]);
  });

  it('rejects public success payloads that expose ids or tracking fields', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 1,
      accepted: true,
      message: 'feedback_received',
      feedbackId: 'fb-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(submitFeedback(featureRequest())).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('maps rate-limited and unavailable failures to retryable sanitized errors', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'rate_limited', detail: 'C:/secret/path' },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }));

    await expect(submitFeedback(featureRequest())).rejects.toSatisfy((error: unknown) => (
      error instanceof FeedbackApiError
      && error.retryable
      && error.message === '反馈提交过于频繁，请稍后再试。'
      && !error.message.includes('secret')
    ));
  });

  it('validates upload receipts against the request and rejects drift', async () => {
    const upload: FeedbackUploadRequest = {
      schemaVersion: 1,
      clientUploadId: 'client-upload-log',
      kind: 'log',
      displayName: 'editor.log',
      mediaType: 'text/plain',
      decodedByteSize: 11,
      contentBase64: 'aGVsbG8gd29ybGQ=',
    };
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 1,
      uploadId: 'feedback-upload',
      kind: 'trace',
      displayName: 'editor.log',
      mediaType: 'text/plain',
      decodedByteSize: 11,
      expiresAt: '2026-08-11T10:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(uploadFeedbackAttachment(upload)).rejects.toMatchObject({ code: 'internal_error' });
  });
});

function featureRequest(clientSubmissionId = 'client-submission-feature'): FeedbackSubmissionRequest {
  return {
    schemaVersion: 1,
    clientSubmissionId,
    feedback: {
      type: 'feature',
      title: 'Remember folders',
      scenario: 'I compare often.',
      desiredImprovement: 'Show recent folders.',
      value: 'Less repeated navigation.',
    },
  };
}
