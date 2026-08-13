import { describe, expect, it } from 'vitest';
import { EMPTY_FEEDBACK_DRAFT, type FeedbackDraft } from './types';
import { buildFeedbackSubmission, validateFeedbackDraft } from './validation';

function draft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    type: overrides.type ?? 'bug',
    bug: { ...EMPTY_FEEDBACK_DRAFT.bug, ...overrides.bug },
    feature: { ...EMPTY_FEEDBACK_DRAFT.feature, ...overrides.feature },
    contact: overrides.contact ?? '',
  };
}

describe('Feedback validation', () => {
  it('requires only the core Bug fields and trims optional fields in the final submission', () => {
    const empty = validateFeedbackDraft(draft({ type: 'bug' }));
    expect(empty.valid).toBe(false);
    expect(empty.issues.map((issue) => issue.field)).toEqual([
      'bug.title',
      'bug.description',
    ]);

    const request = buildFeedbackSubmission(
      draft({
        type: 'bug',
        bug: {
          title: '  Crash  ',
          description: 'The app closes.',
          reproduction: 'Open the app.',
          expected: 'It stays open.',
          actual: 'It closes.',
        },
        contact: ' maintainer@example.com ',
      }),
      'client-submission-bug',
      { appVersion: '0.1.9', osFamily: 'windows', activeModule: 'feedback' },
      ['upload-1'],
    );

    expect(request).toEqual({
      schemaVersion: 1,
      clientSubmissionId: 'client-submission-bug',
      contact: 'maintainer@example.com',
      metadata: { appVersion: '0.1.9', osFamily: 'windows', activeModule: 'feedback' },
      feedback: {
        type: 'bug',
        title: 'Crash',
        description: 'The app closes.',
        reproduction: 'Open the app.',
        expected: 'It stays open.',
        actual: 'It closes.',
        attachmentUploadIds: ['upload-1'],
      },
    });
    expect(JSON.stringify(request)).not.toMatch(/contentBase64|feedbackId|trackingId|admin|status/i);
  });

  it('requires only the core Feature Request fields and rejects overlong contact', () => {
    const empty = validateFeedbackDraft(draft({ type: 'feature', contact: 'x'.repeat(255) }));
    expect(empty.valid).toBe(false);
    expect(empty.issues.map((issue) => issue.field)).toEqual([
      'feature.title',
      'feature.desiredImprovement',
      'contact',
    ]);
  });

  it('accepts empty optional details for both feedback types', () => {
    expect(validateFeedbackDraft(draft({
      type: 'bug',
      bug: { ...EMPTY_FEEDBACK_DRAFT.bug, title: 'Crash', description: 'The app closes.' },
    })).valid).toBe(true);
    expect(validateFeedbackDraft(draft({
      type: 'feature',
      feature: { ...EMPTY_FEEDBACK_DRAFT.feature, title: 'Recent folders', desiredImprovement: 'Remember recent folders.' },
    })).valid).toBe(true);
  });
});
