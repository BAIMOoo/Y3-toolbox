import type {
  FeedbackBugPayload,
  FeedbackDraft,
  FeedbackFeaturePayload,
  FeedbackSubmissionRequest,
} from './types';

export const FEEDBACK_LIMITS = Object.freeze({
  title: 120,
  longText: 4000,
  mediumText: 2000,
  contact: 254,
});

export interface FeedbackValidationIssue {
  field: string;
  message: string;
}

export interface FeedbackValidationResult {
  valid: boolean;
  issues: FeedbackValidationIssue[];
}

const BUG_REQUIRED_FIELDS = [
  ['bug.title', '标题', FEEDBACK_LIMITS.title],
  ['bug.description', '问题描述', FEEDBACK_LIMITS.longText],
] as const;

const FEATURE_REQUIRED_FIELDS = [
  ['feature.title', '标题', FEEDBACK_LIMITS.title],
  ['feature.desiredImprovement', '希望改进', FEEDBACK_LIMITS.longText],
] as const;

const OPTIONAL_FIELDS = [
  ['bug.reproduction', '复现步骤', FEEDBACK_LIMITS.longText],
  ['bug.expected', '预期结果', FEEDBACK_LIMITS.mediumText],
  ['bug.actual', '实际结果', FEEDBACK_LIMITS.mediumText],
  ['feature.scenario', '使用场景', FEEDBACK_LIMITS.longText],
  ['feature.value', '价值或原因', FEEDBACK_LIMITS.mediumText],
] as const;

export function validateFeedbackDraft(draft: FeedbackDraft): FeedbackValidationResult {
  const issues: FeedbackValidationIssue[] = [];
  const fields = draft.type === 'bug' ? BUG_REQUIRED_FIELDS : FEATURE_REQUIRED_FIELDS;
  for (const [field, label, limit] of fields) {
    const value = readDraftField(draft, field);
    if (!value.trim()) {
      issues.push({ field, message: `请填写${label}。` });
    } else if (value.trim().length > limit) {
      issues.push({ field, message: `${label}不能超过 ${limit} 个字符。` });
    }
  }
  for (const [field, label, limit] of OPTIONAL_FIELDS) {
    const value = readDraftField(draft, field);
    if (value.trim().length > limit) {
      issues.push({ field, message: `${label}不能超过 ${limit} 个字符。` });
    }
  }
  if (draft.contact.trim().length > FEEDBACK_LIMITS.contact) {
    issues.push({ field: 'contact', message: `联系方式不能超过 ${FEEDBACK_LIMITS.contact} 个字符。` });
  }
  return { valid: issues.length === 0, issues };
}

export function buildFeedbackSubmission(
  draft: FeedbackDraft,
  clientSubmissionId: string,
  metadata: FeedbackSubmissionRequest['metadata'],
  attachmentUploadIds: readonly string[] = [],
): FeedbackSubmissionRequest {
  const validation = validateFeedbackDraft(draft);
  if (!validation.valid) {
    throw new FeedbackDraftValidationError(validation.issues);
  }
  const common = {
    schemaVersion: 1 as const,
    clientSubmissionId,
    ...(draft.contact.trim() ? { contact: draft.contact.trim() } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  if (draft.type === 'bug') {
    const feedback: FeedbackBugPayload = {
      type: 'bug',
      title: draft.bug.title.trim(),
      description: draft.bug.description.trim(),
      reproduction: draft.bug.reproduction.trim(),
      expected: draft.bug.expected.trim(),
      actual: draft.bug.actual.trim(),
      ...(attachmentUploadIds.length ? { attachmentUploadIds: [...attachmentUploadIds] } : {}),
    };
    return { ...common, feedback };
  }
  const feedback: FeedbackFeaturePayload = {
    type: 'feature',
    title: draft.feature.title.trim(),
    scenario: draft.feature.scenario.trim(),
    desiredImprovement: draft.feature.desiredImprovement.trim(),
    value: draft.feature.value.trim(),
  };
  return { ...common, feedback };
}

export class FeedbackDraftValidationError extends Error {
  readonly issues: FeedbackValidationIssue[];

  constructor(issues: FeedbackValidationIssue[]) {
    super(issues[0]?.message ?? '反馈内容无效。');
    this.name = 'FeedbackDraftValidationError';
    this.issues = issues;
  }
}

function readDraftField(draft: FeedbackDraft, field: string): string {
  if (field === 'bug.title') return draft.bug.title;
  if (field === 'bug.description') return draft.bug.description;
  if (field === 'bug.reproduction') return draft.bug.reproduction;
  if (field === 'bug.expected') return draft.bug.expected;
  if (field === 'bug.actual') return draft.bug.actual;
  if (field === 'feature.title') return draft.feature.title;
  if (field === 'feature.scenario') return draft.feature.scenario;
  if (field === 'feature.desiredImprovement') return draft.feature.desiredImprovement;
  if (field === 'feature.value') return draft.feature.value;
  return '';
}
