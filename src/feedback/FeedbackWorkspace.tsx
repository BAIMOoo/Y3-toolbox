import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Segmented, Tag } from 'antd';
import './Feedback.css';
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  prepareFeedbackAttachments,
  totalFeedbackAttachmentBytes,
  type PreparedFeedbackAttachment,
} from './attachments';
import {
  clearCachedFeedbackSession,
  createFeedbackClientId,
  ensureFeedbackSession,
  FeedbackApiError,
  submitFeedback,
  uploadFeedbackAttachment,
} from './api';
import { createFeedbackMetadata, FEEDBACK_METADATA_KEYS } from './metadata';
import { buildFeedbackSubmission, validateFeedbackDraft, type FeedbackValidationIssue } from './validation';
import { EMPTY_FEEDBACK_DRAFT, type FeedbackActiveModule, type FeedbackDraft, type FeedbackType } from './types';

const { TextArea } = Input;

type SubmitPhase = 'idle' | 'validating' | 'uploading' | 'submitting' | 'success' | 'error';

export interface FeedbackWorkspaceProps {
  activeModule: FeedbackActiveModule;
}

export function FeedbackWorkspace({ activeModule }: FeedbackWorkspaceProps) {
  const [draft, setDraft] = useState<FeedbackDraft>(() => cloneEmptyDraft());
  const [attachments, setAttachments] = useState<PreparedFeedbackAttachment[]>([]);
  const [issues, setIssues] = useState<FeedbackValidationIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const [isRetryable, setIsRetryable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const submissionIdRef = useRef<string | null>(null);
  if (!submissionIdRef.current) submissionIdRef.current = createFeedbackClientId('client-submission');
  const submitAttemptedRef = useRef(false);

  const metadata = useMemo(() => createFeedbackMetadata(activeModule), [activeModule]);
  const submitting = phase === 'validating' || phase === 'uploading' || phase === 'submitting';
  const showAttachments = draft.type === 'bug';

  const setType = (type: FeedbackType) => {
    rotateSubmissionIdAfterAttempt();
    setDraft((current) => ({ ...current, type }));
    setIssues([]);
    setMessage(null);
    setPhase((current) => (current === 'success' ? 'idle' : current));
    if (type === 'feature') setAttachments([]);
  };

  const updateBug = (field: keyof FeedbackDraft['bug'], value: string) => {
    rotateSubmissionIdAfterAttempt();
    setDraft((current) => ({ ...current, bug: { ...current.bug, [field]: value } }));
    setIssues([]);
    setMessage(null);
    setPhase((current) => (current === 'success' ? 'idle' : current));
  };

  const updateFeature = (field: keyof FeedbackDraft['feature'], value: string) => {
    rotateSubmissionIdAfterAttempt();
    setDraft((current) => ({ ...current, feature: { ...current.feature, [field]: value } }));
    setIssues([]);
    setMessage(null);
    setPhase((current) => (current === 'success' ? 'idle' : current));
  };

  const updateContact = (value: string) => {
    rotateSubmissionIdAfterAttempt();
    setDraft((current) => ({ ...current, contact: value }));
    setIssues([]);
    setMessage(null);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const prepared = await prepareFeedbackAttachments(Array.from(files), attachments, () => createFeedbackClientId('client-upload'));
      rotateSubmissionIdAfterAttempt();
      setAttachments((current) => [...current, ...prepared]);
      setMessage(null);
      setIssues([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '附件无法添加。');
      setPhase('error');
      setIsRetryable(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (clientUploadId: string) => {
    rotateSubmissionIdAfterAttempt();
    setAttachments((current) => current.filter((attachment) => attachment.clientUploadId !== clientUploadId));
  };

  const resetDraft = () => {
    setDraft(cloneEmptyDraft());
    setAttachments([]);
    setIssues([]);
    setMessage(null);
    setPhase('idle');
    setIsRetryable(false);
    submissionIdRef.current = createFeedbackClientId('client-submission');
    submitAttemptedRef.current = false;
  };

  const submit = async () => {
    setPhase('validating');
    setMessage(null);
    setIsRetryable(false);
    const nextValidation = validateFeedbackDraft(draft);
    if (!nextValidation.valid) {
      setIssues(nextValidation.issues);
      setMessage(nextValidation.issues[0]?.message ?? '请检查反馈内容。');
      setPhase('error');
      setIsRetryable(false);
      return;
    }

    const controller = new AbortController();
    try {
      submitAttemptedRef.current = true;
      await ensureFeedbackSession(controller.signal);
      const uploadedIds: string[] = [];
      if (draft.type === 'bug') {
        for (const attachment of attachments) {
          if (attachment.uploadId && attachment.status === 'uploaded') {
            uploadedIds.push(attachment.uploadId);
            continue;
          }
          setPhase('uploading');
          setAttachments((current) => current.map((item) => (
            item.clientUploadId === attachment.clientUploadId ? { ...item, status: 'uploading' } : item
          )));
          const receipt = await uploadFeedbackAttachment(attachment, controller.signal);
          uploadedIds.push(receipt.uploadId);
          setAttachments((current) => current.map((item) => (
            item.clientUploadId === attachment.clientUploadId ? { ...item, status: 'uploaded', uploadId: receipt.uploadId } : item
          )));
        }
      }
      setPhase('submitting');
      const clientSubmissionId = submissionIdRef.current;
      if (!clientSubmissionId) throw new Error('Feedback submission identity is unavailable.');
      const request = buildFeedbackSubmission(draft, clientSubmissionId, metadata, uploadedIds);
      await submitFeedback(request, controller.signal);
      setPhase('success');
      setIssues([]);
      setMessage('反馈已收到。感谢你花时间把问题或想法写清楚。');
      setDraft(cloneEmptyDraft());
      setAttachments([]);
      submissionIdRef.current = createFeedbackClientId('client-submission');
      submitAttemptedRef.current = false;
    } catch (error) {
      const retryable = error instanceof FeedbackApiError ? error.retryable : true;
      if (error instanceof FeedbackApiError && error.code === 'invalid_session') {
        clearCachedFeedbackSession();
        setAttachments((current) => current.map((item) => ({ ...item, status: 'pending', uploadId: undefined })));
      }
      setPhase('error');
      setIsRetryable(retryable);
      setMessage(error instanceof Error ? error.message : '反馈未能提交，请稍后重试。');
      setAttachments((current) => current.map((item) => (
        item.status === 'uploading' ? { ...item, status: 'error' } : item
      )));
    }
  };

  const rotateSubmissionIdAfterAttempt = () => {
    if (!submitAttemptedRef.current) return;
    submissionIdRef.current = createFeedbackClientId('client-submission');
    submitAttemptedRef.current = false;
  };

  return (
    <section className="feedback-workspace" aria-labelledby="feedback-title">
      <div className="feedback-panel">
        <div className="feedback-heading">
          <div>
            <h1 id="feedback-title">反馈</h1>
            <p>此处主要接收 Y3 工具箱相关的 Bug 和功能建议，Y3 编辑器相关反馈也可提交，但不保证及时处理。</p>
          </div>
        </div>

        <div className="feedback-fields">
          <fieldset className="feedback-type-question">
            <legend>1. 你想反馈什么？</legend>
            <Segmented<FeedbackType>
              block
              value={draft.type}
              onChange={setType}
              options={[
                { label: '遇到了 Bug', value: 'bug' },
                { label: '有功能建议', value: 'feature' },
              ]}
            />
          </fieldset>
          {draft.type === 'bug' ? (
            <>
              <FeedbackInput label="2. 用一句话概括问题" placeholder="例如：对比两个存档时应用闪退" field="bug.title" value={draft.bug.title} maxLength={120} issue={findIssue(issues, 'bug.title')} onChange={(value) => updateBug('title', value)} />
              <FeedbackTextArea label="3. 发生了什么？" placeholder="描述你当时在做什么、看到了什么；能写清楚即可。" field="bug.description" value={draft.bug.description} maxLength={4000} issue={findIssue(issues, 'bug.description')} onChange={(value) => updateBug('description', value)} />
            </>
          ) : (
            <>
              <FeedbackInput label="2. 用一句话概括建议" placeholder="例如：记住最近打开的存档目录" field="feature.title" value={draft.feature.title} maxLength={120} issue={findIssue(issues, 'feature.title')} onChange={(value) => updateFeature('title', value)} />
              <FeedbackTextArea label="3. 你希望怎么改进？" placeholder="说说想要的效果；不需要写完整方案。" field="feature.desiredImprovement" value={draft.feature.desiredImprovement} maxLength={4000} issue={findIssue(issues, 'feature.desiredImprovement')} onChange={(value) => updateFeature('desiredImprovement', value)} />
            </>
          )}
        </div>

        <details className="feedback-optional">
          <summary>补充信息（可选）</summary>
          <p className="feedback-optional-hint">有时间再填，留空也可以提交。</p>
          <div className="feedback-fields">
            {draft.type === 'bug' ? (
              <>
                <FeedbackTextArea label="复现步骤" field="bug.reproduction" value={draft.bug.reproduction} maxLength={4000} issue={findIssue(issues, 'bug.reproduction')} onChange={(value) => updateBug('reproduction', value)} required={false} />
                <div className="feedback-field-row">
                  <FeedbackTextArea label="预期结果" field="bug.expected" value={draft.bug.expected} maxLength={2000} issue={findIssue(issues, 'bug.expected')} onChange={(value) => updateBug('expected', value)} required={false} />
                  <FeedbackTextArea label="实际结果" field="bug.actual" value={draft.bug.actual} maxLength={2000} issue={findIssue(issues, 'bug.actual')} onChange={(value) => updateBug('actual', value)} required={false} />
                </div>
              </>
            ) : (
              <>
                <FeedbackTextArea label="使用场景" field="feature.scenario" value={draft.feature.scenario} maxLength={4000} issue={findIssue(issues, 'feature.scenario')} onChange={(value) => updateFeature('scenario', value)} required={false} />
                <FeedbackTextArea label="价值或原因" field="feature.value" value={draft.feature.value} maxLength={2000} issue={findIssue(issues, 'feature.value')} onChange={(value) => updateFeature('value', value)} required={false} />
              </>
            )}
            <FeedbackInput label="联系方式（方便我们进一步确认）" field="contact" value={draft.contact} maxLength={254} issue={findIssue(issues, 'contact')} onChange={updateContact} required={false} />
          </div>

          {showAttachments && (
            <div className="feedback-attachments">
              <div className="feedback-section-label">截图或日志</div>
              <p>最多 5 个；日志/Trace 单个 2 MiB，截图单个 8 MiB，总计 16 MiB。请先检查附件中的敏感内容。</p>
              <input
                ref={fileInputRef}
                id="feedback-attachments"
                type="file"
                multiple
                accept={FEEDBACK_ATTACHMENT_ACCEPT}
                aria-label="选择 Bug 附件"
                onChange={(event) => void addFiles(event.currentTarget.files)}
              />
              <div className="feedback-attachment-list" aria-live="polite">
                {attachments.map((attachment) => (
                  <div className="feedback-attachment-row" key={attachment.clientUploadId}>
                    <span>{attachment.displayName}</span>
                    <Tag>{attachment.kind}</Tag>
                    <span>{formatBytes(attachment.decodedByteSize)}</span>
                    <span>{attachment.status}</span>
                    <button type="button" aria-label={`移除附件 ${attachment.displayName}`} onClick={() => removeAttachment(attachment.clientUploadId)} disabled={submitting}>
                      移除
                    </button>
                  </div>
                ))}
              </div>
              <div className="feedback-attachment-total">当前附件总计：{formatBytes(totalFeedbackAttachmentBytes(attachments))}</div>
            </div>
          )}

          <Alert
            className="feedback-privacy"
            type="info"
            showIcon
            title="隐私说明"
            description="客户端只会附带下方列出的元数据，不会上传路径、Token、项目内容或设备标识。"
          />
          <div className="feedback-metadata" aria-label="自动附带的元数据">
            <div className="feedback-section-label">自动附带</div>
            {FEEDBACK_METADATA_KEYS.map((key) => (
              <span key={key}><strong>{key}</strong>: {metadata[key] ?? 'unknown'}</span>
            ))}
          </div>
        </details>

        {message && (
          <Alert
            role="status"
            type={phase === 'success' ? 'success' : isRetryable ? 'warning' : 'error'}
            showIcon
            title={message}
            description={phase === 'success' ? '这不是工单号，也没有状态追踪链接。' : isRetryable ? '草稿和有效附件已保留，可以直接重试。' : undefined}
          />
        )}

        <div className="feedback-actions">
          <Button onClick={resetDraft} disabled={submitting}>清空</Button>
          <Button type="primary" onClick={() => void submit()} loading={submitting}>
            {submitting ? '提交中…' : isRetryable ? '重试提交' : '提交反馈'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function FeedbackInput({
  label,
  field,
  value,
  maxLength,
  issue,
  onChange,
  placeholder,
  required = true,
}: {
  label: string;
  field: string;
  value: string;
  maxLength: number;
  issue?: FeedbackValidationIssue;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const id = `feedback-${field.replace(/\./g, '-')}`;
  const errorId = `${id}-error`;
  return (
    <label className="feedback-field" htmlFor={id}>
      <span>{label}{required ? ' *' : ''}</span>
      <Input id={id} value={value} placeholder={placeholder} maxLength={maxLength} showCount aria-invalid={Boolean(issue)} aria-describedby={issue ? errorId : undefined} onChange={(event) => onChange(event.currentTarget.value)} />
      {issue && <small id={errorId} role="alert">{issue.message}</small>}
    </label>
  );
}

function FeedbackTextArea({
  label,
  field,
  value,
  maxLength,
  issue,
  onChange,
  placeholder,
  required = true,
}: {
  label: string;
  field: string;
  value: string;
  maxLength: number;
  issue?: FeedbackValidationIssue;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const id = `feedback-${field.replace(/\./g, '-')}`;
  const errorId = `${id}-error`;
  return (
    <label className="feedback-field" htmlFor={id}>
      <span>{label}{required ? ' *' : ''}</span>
      <TextArea id={id} value={value} placeholder={placeholder} maxLength={maxLength} showCount autoSize={{ minRows: 3, maxRows: 8 }} aria-invalid={Boolean(issue)} aria-describedby={issue ? errorId : undefined} onChange={(event) => onChange(event.currentTarget.value)} />
      {issue && <small id={errorId} role="alert">{issue.message}</small>}
    </label>
  );
}

function findIssue(issues: readonly FeedbackValidationIssue[], field: string): FeedbackValidationIssue | undefined {
  return issues.find((issue) => issue.field === field);
}

function cloneEmptyDraft(): FeedbackDraft {
  return {
    type: EMPTY_FEEDBACK_DRAFT.type,
    bug: { ...EMPTY_FEEDBACK_DRAFT.bug },
    feature: { ...EMPTY_FEEDBACK_DRAFT.feature },
    contact: EMPTY_FEEDBACK_DRAFT.contact,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
