import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  FeedbackSessionResponse,
  FeedbackSubmissionAcknowledgement,
  FeedbackSubmissionRequest,
  FeedbackUploadRequest,
} from './types';

describe('Feedback mirrored contract fixture', () => {
  it('keeps the local deterministic fixture aligned with public feedback DTO semantics', () => {
    const fixture = readFeedbackContractFixture();

    const session: FeedbackSessionResponse = fixture.bug.session;
    expect(session).toEqual({
      schemaVersion: 1,
      sessionId: 'feedback-session-fixture',
      expiresAt: '2026-08-11T10:00:00.000Z',
    });

    const upload: FeedbackUploadRequest = fixture.bug.upload;
    expect(upload).toMatchObject({
      schemaVersion: 1,
      clientUploadId: 'client-upload-log',
      kind: 'log',
      displayName: 'editor.log',
      mediaType: 'text/plain',
      decodedByteSize: 11,
      contentBase64: 'aGVsbG8gd29ybGQ=',
    });

    const bugSubmission: FeedbackSubmissionRequest = fixture.bug.submission;
    expect(bugSubmission).toMatchObject({
      schemaVersion: 1,
      clientSubmissionId: 'client-submission-bug',
      contact: 'maintainer@example.com',
      metadata: {
        appVersion: '0.1.9',
        osFamily: 'windows',
        activeModule: 'agent-jobs',
      },
      feedback: {
        type: 'bug',
        title: 'Archive compare failed',
        description: 'The compare action shows a retryable failure.',
        reproduction: 'Open two archives, then click compare.',
        expected: 'The diff table is shown.',
        actual: 'The app shows a failure banner.',
        attachmentUploadIds: ['feedback-upload-fixture'],
      },
    });

    const featureSubmission: FeedbackSubmissionRequest = fixture.feature.submission;
    expect(featureSubmission).toMatchObject({
      schemaVersion: 1,
      clientSubmissionId: 'client-submission-feature',
      metadata: {
        appVersion: '0.1.9',
        osFamily: 'windows',
        activeModule: 'local-archive',
      },
      feedback: {
        type: 'feature',
        title: 'Remember recent archive folders',
        scenario: 'I compare archives from the same project repeatedly.',
        desiredImprovement: 'Show recent folders in the picker.',
        value: 'This removes repetitive navigation.',
      },
    });

    const acknowledgement: FeedbackSubmissionAcknowledgement = fixture.bug.acknowledgement;
    expect(acknowledgement).toEqual({
      schemaVersion: 1,
      accepted: true,
      message: 'feedback_received',
    });
    expect(Object.keys(acknowledgement).sort()).toEqual(['accepted', 'message', 'schemaVersion']);
    expect(JSON.stringify(fixture)).not.toMatch(/feedbackId|trackingId|adminUrl|statusUrl|historyUrl/i);
  });
});

interface FeedbackContractFixture {
  schemaVersion: 1;
  bug: {
    session: FeedbackSessionResponse;
    upload: FeedbackUploadRequest;
    submission: FeedbackSubmissionRequest;
    acknowledgement: FeedbackSubmissionAcknowledgement;
  };
  feature: {
    submission: FeedbackSubmissionRequest;
  };
}

function readFeedbackContractFixture(): FeedbackContractFixture {
  return JSON.parse(readFileSync(new URL('./feedbackContract.fixture.json', import.meta.url), 'utf8')) as FeedbackContractFixture;
}
