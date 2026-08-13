export type FeedbackType = 'bug' | 'feature';
export type FeedbackAttachmentKind = 'log' | 'trace' | 'screenshot';
export type FeedbackErrorCode = 'invalid_request' | 'invalid_session' | 'rate_limited' | 'service_unavailable' | 'internal_error';
export type FeedbackActiveModule = 'diff' | 'local-archive' | 'agent-jobs' | 'technical-qa' | 'feedback';

export interface FeedbackSessionResponse {
  schemaVersion: 1;
  sessionId: string;
  expiresAt: string;
}

export interface FeedbackUploadRequest {
  schemaVersion: 1;
  clientUploadId: string;
  kind: FeedbackAttachmentKind;
  displayName: string;
  mediaType: string;
  decodedByteSize: number;
  contentBase64: string;
}

export interface FeedbackUploadResponse {
  schemaVersion: 1;
  uploadId: string;
  kind: FeedbackAttachmentKind;
  displayName: string;
  mediaType: string;
  decodedByteSize: number;
  expiresAt: string;
}

export interface FeedbackClientMetadata {
  appVersion?: string;
  osFamily?: string;
  activeModule?: FeedbackActiveModule;
}

export interface FeedbackBugPayload {
  type: 'bug';
  title: string;
  description: string;
  reproduction: string;
  expected: string;
  actual: string;
  attachmentUploadIds?: string[];
}

export interface FeedbackFeaturePayload {
  type: 'feature';
  title: string;
  scenario: string;
  desiredImprovement: string;
  value: string;
}

export interface FeedbackSubmissionRequest {
  schemaVersion: 1;
  clientSubmissionId: string;
  contact?: string;
  metadata?: FeedbackClientMetadata;
  feedback: FeedbackBugPayload | FeedbackFeaturePayload;
}

export interface FeedbackSubmissionAcknowledgement {
  schemaVersion: 1;
  accepted: true;
  message: 'feedback_received';
}

export interface FeedbackDraft {
  type: FeedbackType;
  bug: {
    title: string;
    description: string;
    reproduction: string;
    expected: string;
    actual: string;
  };
  feature: {
    title: string;
    scenario: string;
    desiredImprovement: string;
    value: string;
  };
  contact: string;
}

export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = Object.freeze({
  type: 'bug',
  bug: Object.freeze({
    title: '',
    description: '',
    reproduction: '',
    expected: '',
    actual: '',
  }),
  feature: Object.freeze({
    title: '',
    scenario: '',
    desiredImprovement: '',
    value: '',
  }),
  contact: '',
});
