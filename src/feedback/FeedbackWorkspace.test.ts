// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedbackSubmissionRequest } from './types';

const apiMocks = vi.hoisted(() => ({
  ensureFeedbackSession: vi.fn(),
  clearCachedFeedbackSession: vi.fn(),
  uploadFeedbackAttachment: vi.fn(),
  submitFeedback: vi.fn(),
  createFeedbackClientId: vi.fn(),
  FeedbackApiError: class MockFeedbackApiError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;

    constructor(code: string, status: number, retryable = true) {
      super(code);
      this.name = 'FeedbackApiError';
      this.code = code;
      this.status = status;
      this.retryable = retryable;
    }
  },
}));

vi.mock('./api', () => ({
  ensureFeedbackSession: apiMocks.ensureFeedbackSession,
  clearCachedFeedbackSession: apiMocks.clearCachedFeedbackSession,
  uploadFeedbackAttachment: apiMocks.uploadFeedbackAttachment,
  submitFeedback: apiMocks.submitFeedback,
  createFeedbackClientId: apiMocks.createFeedbackClientId,
  FeedbackApiError: apiMocks.FeedbackApiError,
}));

vi.mock('../agentJobs/agentCompatibility', () => ({
  Y3_TOOLBOX_CLIENT_VERSION: '0.1.9',
}));

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: TestResizeObserver });
  Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: TestResizeObserver });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FeedbackWorkspace', () => {
  it('renders distinct Bug and Feature Request field sets', async () => {
    apiMocks.createFeedbackClientId.mockReturnValue('client-submission-initial');
    const { FeedbackWorkspace } = await import('./FeedbackWorkspace');
    const { container } = render(React.createElement(FeedbackWorkspace, { activeModule: 'feedback' }));

    expect(screen.getByText(/此处主要接收 Y3 工具箱相关的 Bug 和功能建议/)).toBeTruthy();
    expect(screen.getByText(/Y3 编辑器相关反馈也可提交，但不保证及时处理/)).toBeTruthy();
    expect(screen.queryByText('请填写标题。')).toBeNull();
    expect(screen.getByText('1. 你想反馈什么？')).toBeTruthy();
    expect(field(container, 'feedback-bug-description')).toBeTruthy();
    expect(container.querySelector('#feedback-feature-scenario')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /有功能建议/ }));

    expect(field(container, 'feedback-feature-scenario')).toBeTruthy();
    expect(container.querySelector('#feedback-bug-description')).toBeNull();
    expect(container.querySelector('#feedback-attachments')).toBeNull();
  });

  it('keeps optional questions collapsed and submits with only core answers', async () => {
    apiMocks.createFeedbackClientId.mockReturnValue('client-submission-minimal');
    apiMocks.ensureFeedbackSession.mockResolvedValue(serverSession());
    apiMocks.submitFeedback.mockResolvedValue({ schemaVersion: 1, accepted: true, message: 'feedback_received' });
    const { FeedbackWorkspace } = await import('./FeedbackWorkspace');
    const { container } = render(React.createElement(FeedbackWorkspace, { activeModule: 'feedback' }));

    const optional = screen.getByText('补充信息（可选）').closest('details');
    expect(optional?.hasAttribute('open')).toBe(false);
    fireEvent.change(field(container, 'feedback-bug-title'), { target: { value: 'Crash' } });
    fireEvent.change(field(container, 'feedback-bug-description'), { target: { value: 'The app closes.' } });
    clickPrimarySubmit(container);

    await waitFor(() => expect(apiMocks.submitFeedback).toHaveBeenCalledTimes(1));
    expect(apiMocks.submitFeedback.mock.calls[0]?.[0]).toMatchObject({
      feedback: { type: 'bug', title: 'Crash', description: 'The app closes.', reproduction: '', expected: '', actual: '' },
    });
  });

  it('shows validation errors only after a submit attempt', async () => {
    apiMocks.createFeedbackClientId.mockReturnValue('client-submission-validation');
    const { FeedbackWorkspace } = await import('./FeedbackWorkspace');
    const { container } = render(React.createElement(FeedbackWorkspace, { activeModule: 'feedback' }));

    expect(screen.queryByText('请填写标题。')).toBeNull();
    clickPrimarySubmit(container);

    expect(await screen.findAllByText('请填写标题。')).toHaveLength(2);
    expect(apiMocks.ensureFeedbackSession).not.toHaveBeenCalled();
  });

  it('submits acknowledgement-only success and never renders backend ids, URLs, or tracking links', async () => {
    apiMocks.createFeedbackClientId
      .mockReturnValueOnce('client-submission-1')
      .mockReturnValue('client-submission-next');
    apiMocks.ensureFeedbackSession.mockResolvedValue(serverSession());
    apiMocks.submitFeedback.mockResolvedValue({ schemaVersion: 1, accepted: true, message: 'feedback_received' });
    const { FeedbackWorkspace } = await import('./FeedbackWorkspace');
    const { container } = render(React.createElement(FeedbackWorkspace, { activeModule: 'feedback' }));

    fillBug(container);
    clickPrimarySubmit(container);

    await waitFor(() => expect(apiMocks.submitFeedback).toHaveBeenCalledTimes(1));
    const request = apiMocks.submitFeedback.mock.calls[0]?.[0] as FeedbackSubmissionRequest;
    expect(request.clientSubmissionId).toBe('client-submission-1');
    expect(request.metadata).toEqual({ appVersion: '0.1.9', osFamily: expect.any(String), activeModule: 'feedback' });
    expect(document.body.textContent).not.toMatch(/feedbackId|trackingId|adminUrl|statusUrl|historyUrl|\/admin\/feedback|\/api\/feedback\/.*\bfb-/i);
  });

  it('reuses uploaded receipts and the same submission id on unchanged retry', async () => {
    apiMocks.createFeedbackClientId
      .mockReturnValueOnce('client-submission-retry')
      .mockReturnValueOnce('client-upload-log')
      .mockReturnValue('client-unused');
    apiMocks.ensureFeedbackSession.mockResolvedValue(serverSession());
    apiMocks.uploadFeedbackAttachment.mockResolvedValue(uploadReceipt('feedback-upload-log'));
    apiMocks.submitFeedback
      .mockRejectedValueOnce(new apiMocks.FeedbackApiError('rate_limited', 429, true))
      .mockResolvedValueOnce({ schemaVersion: 1, accepted: true, message: 'feedback_received' });
    const { FeedbackWorkspace } = await import('./FeedbackWorkspace');
    const { container } = render(React.createElement(FeedbackWorkspace, { activeModule: 'feedback' }));

    fillBug(container);
    addLogAttachment(container);
    await screen.findByText('editor.log');
    clickPrimarySubmit(container);

    await waitFor(() => expect(apiMocks.submitFeedback).toHaveBeenCalledTimes(1));
    clickPrimarySubmit(container);
    await waitFor(() => expect(apiMocks.submitFeedback).toHaveBeenCalledTimes(2));

    expect(apiMocks.uploadFeedbackAttachment).toHaveBeenCalledTimes(1);
    expect(apiMocks.submitFeedback.mock.calls.map((call) => (call[0] as FeedbackSubmissionRequest).clientSubmissionId))
      .toEqual(['client-submission-retry', 'client-submission-retry']);
    expect(apiMocks.submitFeedback.mock.calls.map((call) => (call[0] as FeedbackSubmissionRequest).feedback))
      .toEqual([
        expect.objectContaining({ attachmentUploadIds: ['feedback-upload-log'] }),
        expect.objectContaining({ attachmentUploadIds: ['feedback-upload-log'] }),
      ]);
  });

  it('clears invalid sessions, reuploads receipts on next attempt, and rotates idempotency after an edit', async () => {
    apiMocks.createFeedbackClientId
      .mockReturnValueOnce('client-submission-original')
      .mockReturnValueOnce('client-upload-log')
      .mockReturnValueOnce('client-submission-edited')
      .mockReturnValue('client-unused');
    apiMocks.ensureFeedbackSession.mockResolvedValue(serverSession());
    apiMocks.uploadFeedbackAttachment
      .mockResolvedValueOnce(uploadReceipt('feedback-upload-before-invalid-session'))
      .mockResolvedValueOnce(uploadReceipt('feedback-upload-after-invalid-session'));
    apiMocks.submitFeedback
      .mockRejectedValueOnce(new apiMocks.FeedbackApiError('invalid_session', 401, true))
      .mockResolvedValueOnce({ schemaVersion: 1, accepted: true, message: 'feedback_received' });
    const { FeedbackWorkspace } = await import('./FeedbackWorkspace');
    const { container } = render(React.createElement(FeedbackWorkspace, { activeModule: 'feedback' }));

    fillBug(container);
    addLogAttachment(container);
    await screen.findByText('editor.log');
    clickPrimarySubmit(container);
    await waitFor(() => expect(apiMocks.submitFeedback).toHaveBeenCalledTimes(1));

    expect(apiMocks.clearCachedFeedbackSession).toHaveBeenCalledTimes(1);
    fireEvent.change(field(container, 'feedback-bug-title'), { target: { value: 'Crash after edit' } });
    clickPrimarySubmit(container);
    await waitFor(() => expect(apiMocks.submitFeedback).toHaveBeenCalledTimes(2));

    expect(apiMocks.uploadFeedbackAttachment).toHaveBeenCalledTimes(2);
    expect(apiMocks.submitFeedback.mock.calls.map((call) => (call[0] as FeedbackSubmissionRequest).clientSubmissionId))
      .toEqual(['client-submission-original', 'client-submission-edited']);
    expect(apiMocks.submitFeedback.mock.calls.map((call) => (call[0] as FeedbackSubmissionRequest).feedback))
      .toEqual([
        expect.objectContaining({ attachmentUploadIds: ['feedback-upload-before-invalid-session'] }),
        expect.objectContaining({ attachmentUploadIds: ['feedback-upload-after-invalid-session'] }),
      ]);
  });
});

function fillBug(container: HTMLElement): void {
  fireEvent.change(field(container, 'feedback-bug-title'), { target: { value: 'Crash' } });
  fireEvent.change(field(container, 'feedback-bug-description'), { target: { value: 'The app closes.' } });
  fireEvent.change(field(container, 'feedback-bug-reproduction'), { target: { value: 'Open app.' } });
  fireEvent.change(field(container, 'feedback-bug-expected'), { target: { value: 'Stay open.' } });
  fireEvent.change(field(container, 'feedback-bug-actual'), { target: { value: 'Closed.' } });
}

function addLogAttachment(container: HTMLElement): void {
  fireEvent.change(field(container, 'feedback-attachments'), {
    target: { files: [new File(['hello world'], 'editor.log', { type: 'text/plain' })] },
  });
}

function clickPrimarySubmit(container: HTMLElement): void {
  const submit = container.querySelector<HTMLButtonElement>('.feedback-actions .ant-btn-primary');
  if (!submit) throw new Error('Missing feedback submit button');
  fireEvent.click(submit);
}

function field<T extends HTMLElement = HTMLElement>(container: HTMLElement, id: string): T {
  const element = container.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`Missing field ${id}`);
  return element;
}

function serverSession() {
  return { schemaVersion: 1, sessionId: 'feedback-session', expiresAt: '2026-08-11T10:00:00.000Z' };
}

function uploadReceipt(uploadId: string) {
  return {
    schemaVersion: 1,
    uploadId,
    kind: 'log',
    displayName: 'editor.log',
    mediaType: 'text/plain',
    decodedByteSize: 11,
    expiresAt: '2026-08-11T10:00:00.000Z',
  };
}
