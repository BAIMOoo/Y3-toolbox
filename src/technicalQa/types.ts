export type QaDomain = 'eca_editor' | 'lua_y3_lualib';
export type QaEvidenceState = 'sufficient' | 'insufficient' | 'conflicting';
export type QaSourceAuthority = 'official' | 'maintainer' | 'curated' | 'community';
export type QaSourceKind =
  | 'editor_documentation'
  | 'api_reference'
  | 'maintained_source'
  | 'verified_case'
  | 'community_reference';

export interface QaScope {
  product: 'y3_editor';
  editorVersion: '2.0';
  domain: QaDomain;
}

export interface QaQuestionRequest {
  schemaVersion: 1;
  clientRequestId: string;
  threadId?: string;
  question: string;
  scope: QaScope;
  diagnosticUploadIds?: string[];
}

export type QaDiagnosticKind = 'log' | 'trace' | 'screenshot';

export interface QaDiagnosticUploadRequest {
  schemaVersion: 1;
  clientUploadId: string;
  kind: QaDiagnosticKind;
  displayName: string;
  mediaType: string;
  decodedByteSize: number;
  contentBase64: string;
}

export interface QaDiagnosticUploadAccepted {
  schemaVersion: 1;
  uploadId: string;
  kind: QaDiagnosticKind;
  displayName: string;
  mediaType: string;
  decodedByteSize: number;
  expiresAt: string;
}

export interface QaQuestionAccepted {
  schemaVersion: 1;
  clientRequestId: string;
  threadId: string;
  turnId: string;
  acceptedAt: string;
}

export interface QaCitation {
  citationId: string;
  sourceId: string;
  title: string;
  sourceKind: QaSourceKind;
  authority: QaSourceAuthority;
  locator: string;
  versionScope: 'Y3 2.0';
  excerpt?: string;
  updatedAt?: string;
}

export type QaNonEmptyCitations = [QaCitation, ...QaCitation[]];

export type QaRefusalCode =
  | 'unsupported_scope'
  | 'forbidden_capability'
  | 'insufficient_evidence'
  | 'conflicting_evidence';

export type QaPublicErrorCode =
  | 'invalid_request'
  | 'invalid_cursor'
  | 'cursor_expired'
  | 'rate_limited'
  | 'service_unavailable'
  | 'request_timeout'
  | 'internal_error';

export type QaTerminalOutcome =
  | { kind: 'answer'; answer: string; evidenceState: 'sufficient'; citations: QaNonEmptyCitations }
  | {
      kind: 'follow_up';
      prompt: string;
      missingInformation: string[];
      evidenceState: 'insufficient' | 'conflicting';
      citations: QaCitation[];
    }
  | { kind: 'refusal'; code: QaRefusalCode; message: string; evidenceState: QaEvidenceState; citations: QaCitation[] }
  | { kind: 'error'; code: QaPublicErrorCode; message: string; retryable: boolean }
  | { kind: 'cancelled'; message: string };

export type QaEventType =
  | 'turn.accepted'
  | 'retrieval.started'
  | 'retrieval.completed'
  | 'answer.delta'
  | 'turn.completed';

export interface QaEvent {
  schemaVersion: 1;
  eventId: string;
  threadId: string;
  turnId: string;
  sequence: number;
  type: QaEventType;
  createdAt: string;
  payload:
    | { type: 'turn.accepted' }
    | { type: 'retrieval.started' }
    | { type: 'retrieval.completed'; evidenceState: QaEvidenceState; sourceCount: number }
    | { type: 'answer.delta'; delta: string }
    | { type: 'turn.completed'; outcome: QaTerminalOutcome };
}

export interface QaEventRequest {
  schemaVersion: 1;
  threadId: string;
  turnId: string;
  after: number;
}

export interface QaEventPage {
  schemaVersion: 1;
  threadId: string;
  turnId: string;
  events: QaEvent[];
  nextCursor: number;
  terminal: boolean;
}

export function buildQaEventPath(request: QaEventRequest): string {
  if (request.schemaVersion !== 1 || !request.threadId.trim() || !request.turnId.trim()) {
    throw new Error('Invalid QA event request identifiers.');
  }
  if (!Number.isInteger(request.after) || request.after < 0) {
    throw new Error('Invalid QA event cursor.');
  }
  return `/api/qa/threads/${encodeURIComponent(request.threadId)}/turns/${encodeURIComponent(request.turnId)}/events?after=${request.after}`;
}
