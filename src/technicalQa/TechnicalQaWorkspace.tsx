import {
  BookOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Button, Segmented, Tag, Tooltip } from 'antd';
import type { KeyboardEvent } from 'react';
import { technicalQaApi } from './api';
import type {
  QaThreadSession,
  QaTranscriptTurn,
  TechnicalQaController,
  TechnicalQaState,
} from './controller';
import { useTechnicalQaController } from './useTechnicalQaController';
import type {
  QaCitation,
  QaDomain,
  QaEvidenceState,
  QaTerminalOutcome,
  QaSourceAuthority,
} from './types';
import './TechnicalQa.css';

export interface TechnicalQaWorkspaceViewProps {
  state: TechnicalQaState;
  controller: TechnicalQaController;
}

const DOMAIN_OPTIONS: Array<{ label: string; value: QaDomain }> = [
  { label: 'ECA / 编辑器', value: 'eca_editor' },
  { label: 'Lua / y3-lualib', value: 'lua_y3_lualib' },
];

const AUTHORITY_LABELS: Record<QaSourceAuthority, string> = {
  official: '官方',
  maintainer: '维护者',
  curated: '已核验',
  community: '社区',
};

const EVIDENCE_STATE_LABELS: Record<QaEvidenceState, string> = {
  sufficient: '证据充分',
  insufficient: '证据不足',
  conflicting: '证据冲突',
};

const EVIDENCE_STATE_COLORS: Record<QaEvidenceState, 'success' | 'gold' | 'error'> = {
  sufficient: 'success',
  insufficient: 'gold',
  conflicting: 'error',
};

export function TechnicalQaWorkspace() {
  const { state, controller } = useTechnicalQaController(technicalQaApi);
  return <TechnicalQaWorkspaceView state={state} controller={controller} />;
}

export function TechnicalQaWorkspaceView({ state, controller }: TechnicalQaWorkspaceViewProps) {
  const activeThread = state.threads.find((thread) => thread.key === state.activeThreadKey) ?? state.threads[0];
  const activeTurnInfo = findActiveTurn(state.threads);
  const hasActiveTurn = Boolean(activeTurnInfo);
  const submitDisabled = !state.draft.trim()
    || state.submitting
    || hasActiveTurn
    || state.serviceStatus !== 'ready';
  const disabledReason = getSubmitDisabledReason(state, hasActiveTurn);
  const runtimeMessage = getRuntimeMessage(state, activeTurnInfo);

  const submit = () => {
    if (!submitDisabled) void controller.submit();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    submit();
  };

  return (
    <section className="technical-qa" aria-label="技术问答工作区">
      <header className="technical-qa__header">
        <div className="technical-qa__heading">
          <span className="technical-qa__eyebrow">Y3 技术支持</span>
          <h1>技术问答</h1>
        </div>
        <div className="technical-qa__scope" aria-label="问答范围">
          <Tag bordered={false}>只读问答</Tag>
          <Tag color="blue">Y3 2.0</Tag>
          <ServiceStatus status={state.serviceStatus} />
        </div>
      </header>

      {runtimeMessage && (
        <div className="technical-qa__runtime-strip" role="status" aria-live="polite">
          {runtimeMessage}
        </div>
      )}

      {state.serviceStatus === 'unavailable' && (
        <div className="technical-qa__health-banner" role="alert">
          <div>
            <strong>技术问答服务暂不可用</strong>
            <span>{state.serviceMessage || '当前无法连接问答服务，请稍后重试。'}</span>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => void controller.refreshHealth()}>
            重新检查
          </Button>
        </div>
      )}

      {state.serviceMessage && state.serviceStatus !== 'unavailable' && (
        <div className="technical-qa__notice" role="status">
          {state.serviceMessage}
        </div>
      )}

      <div className="technical-qa__layout">
        <aside className="technical-qa__history" aria-label="问答历史">
          <div className="technical-qa__history-header">
            <div>
              <span>当前会话</span>
              <strong>{state.threads.length} 个线程</strong>
            </div>
            <Tooltip title="新建问答线程">
              <Button
                type="text"
                icon={<PlusOutlined />}
                aria-label="新建问答线程"
                onClick={() => controller.startNewThread()}
              />
            </Tooltip>
          </div>
          <nav className="technical-qa__thread-list" aria-label="问答线程列表">
            {state.threads.map((thread) => (
              <ThreadButton
                key={thread.key}
                thread={thread}
                active={thread.key === state.activeThreadKey}
                onSelect={() => controller.selectThread(thread.key)}
              />
            ))}
          </nav>
        </aside>

        <main className="technical-qa__conversation" aria-label="当前问答对话">
          <div className="technical-qa__transcript">
            {!activeThread || activeThread.turns.length === 0 ? (
              <EmptyConversation domain={state.domain} />
            ) : (
              activeThread.turns.map((turn) => (
                <TranscriptTurn
                  key={turn.clientRequestId}
                  turn={turn}
                  onRetry={(question) => controller.setDraft(question)}
                />
              ))
            )}
          </div>

          <div className="technical-qa__composer">
            <div className="technical-qa__composer-controls">
              <Segmented<QaDomain>
                size="small"
                value={state.domain}
                options={DOMAIN_OPTIONS}
                disabled={state.submitting || hasActiveTurn}
                onChange={(value) => controller.setDomain(value)}
              />
              <span className="technical-qa__scope-note">固定范围：Y3 Editor 2.0</span>
            </div>
            <div className="technical-qa__composer-row">
              <textarea
                value={state.draft}
                rows={3}
                maxLength={4000}
                aria-label="技术问题"
                placeholder={state.domain === 'eca_editor'
                  ? '描述 ECA 事件、动作或编辑器行为。'
                  : '描述 y3-lualib API、符号或运行行为。'}
                disabled={state.serviceStatus === 'unavailable'}
                onChange={(event) => controller.setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <div className="technical-qa__composer-actions">
                {hasActiveTurn ? (
                  <Button
                    danger
                    icon={<StopOutlined />}
                    onClick={() => void controller.cancelActiveTurn()}
                  >
                    取消回答
                  </Button>
                ) : (
                  <Tooltip title={disabledReason || '提交技术问题'}>
                    <span>
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        disabled={submitDisabled}
                        loading={state.submitting}
                        onClick={submit}
                      >
                        提问
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

function ServiceStatus({ status }: { status: TechnicalQaState['serviceStatus'] }) {
  if (status === 'checking') return <Tag color="processing">正在检查</Tag>;
  if (status === 'ready') return <Tag color="success">服务正常</Tag>;
  return <Tag color="error">服务不可用</Tag>;
}

function ThreadButton({
  thread,
  active,
  onSelect,
}: {
  thread: QaThreadSession;
  active: boolean;
  onSelect: () => void;
}) {
  const latestTurn = thread.turns.at(-1);
  return (
    <button
      type="button"
      className={`technical-qa__thread${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
    >
      <span className="technical-qa__thread-title">{thread.title}</span>
      <span className="technical-qa__thread-meta">
        <span>{formatTime(thread.updatedAt)}</span>
        <span>{latestTurn ? getTurnStatusLabel(latestTurn) : '尚未提问'}</span>
      </span>
    </button>
  );
}

function EmptyConversation({ domain }: { domain: QaDomain }) {
  return (
    <div className="technical-qa__empty">
      <BookOutlined aria-hidden="true" />
      <strong>开始一个 Y3 2.0 技术问题</strong>
      <span>
        {domain === 'eca_editor'
          ? '说明涉及的事件、动作和预期编辑器行为。'
          : '提供准确的模块、API 符号和预期运行行为。'}
      </span>
    </div>
  );
}

function TranscriptTurn({
  turn,
  onRetry,
}: {
  turn: QaTranscriptTurn;
  onRetry: (question: string) => void;
}) {
  const evidenceState = getEvidenceState(turn.state.outcome);
  const retryableError = turn.state.outcome?.kind === 'error' && turn.state.outcome.retryable;

  return (
    <article className="technical-qa__turn" aria-label={`问题：${turn.question}`}>
      <div className="technical-qa__question">
        <div className="technical-qa__turn-meta">
          <strong>我</strong>
          <span>{turn.domain === 'eca_editor' ? 'ECA / 编辑器' : 'Lua / y3-lualib'}</span>
          <time dateTime={turn.submittedAt}>{formatTime(turn.submittedAt)}</time>
        </div>
        <p>{turn.question}</p>
      </div>
      <div className={`technical-qa__response technical-qa__response--${turn.state.status}`}>
        <div className="technical-qa__turn-meta">
          <strong>技术问答</strong>
          <span role="status">{getTurnStatusLabel(turn)}</span>
          {evidenceState && (
            <Tag color={EVIDENCE_STATE_COLORS[evidenceState]} className="technical-qa__evidence-tag">
              {EVIDENCE_STATE_LABELS[evidenceState]}
            </Tag>
          )}
        </div>
        <TurnContent turn={turn} />
        {retryableError && (
          <div className="technical-qa__terminal-actions">
            <Button type="link" size="small" onClick={() => onRetry(turn.question)}>
              重新提问
            </Button>
          </div>
        )}
        {turn.state.citations.length > 0 && <CitationList citations={turn.state.citations} />}
      </div>
    </article>
  );
}

function TurnContent({ turn }: { turn: QaTranscriptTurn }) {
  const { state } = turn;
  const { outcome } = state;

  if (state.status === 'loading') {
    return <p className="technical-qa__phase">正在检索并核对 Y3 2.0 证据…</p>;
  }
  if (state.status === 'streaming') {
    return (
      <p className="technical-qa__answer">
        {state.answerText}
        <span className="technical-qa__cursor" aria-hidden="true" />
      </p>
    );
  }
  if (state.status === 'protocol_error') {
    return <p className="technical-qa__terminal-copy">回答数据顺序异常，已停止显示。请重新提问。</p>;
  }
  if (!outcome) return <p className="technical-qa__phase">等待回答…</p>;

  switch (outcome.kind) {
    case 'answer':
      return <p className="technical-qa__answer">{outcome.answer}</p>;
    case 'follow_up':
      return (
        <div className="technical-qa__follow-up">
          <p>{outcome.prompt}</p>
          {outcome.missingInformation.length > 0 && (
            <ul>{outcome.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>
          )}
        </div>
      );
    case 'refusal':
      return <p className="technical-qa__terminal-copy">{outcome.message}</p>;
    case 'error':
      return <p className="technical-qa__terminal-copy">{outcome.message}</p>;
    case 'cancelled':
      return <p className="technical-qa__terminal-copy">{outcome.message}</p>;
  }
}

function CitationList({ citations }: { citations: QaCitation[] }) {
  return (
    <section className="technical-qa__citations" aria-label="引用来源">
      <h3>引用来源</h3>
      <ol>
        {citations.map((citation) => (
          <li key={citation.citationId}>
            <details>
              <summary>
                <span>{citation.title}</span>
                <Tag color={getAuthorityColor(citation.authority)}>
                  {AUTHORITY_LABELS[citation.authority]}
                </Tag>
              </summary>
              <div className="technical-qa__citation-detail">
                <code>{citation.locator}</code>
                <span>{citation.versionScope}</span>
                {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function findActiveTurn(threads: QaThreadSession[]): { thread: QaThreadSession; turn: QaTranscriptTurn } | null {
  for (const thread of threads) {
    const turn = thread.turns.at(-1);
    if (turn && !turn.state.terminal) {
      return { thread, turn };
    }
  }
  return null;
}

function getRuntimeMessage(
  state: TechnicalQaState,
  activeTurnInfo: { thread: QaThreadSession; turn: QaTranscriptTurn } | null,
): string | undefined {
  if (state.serviceStatus === 'checking') {
    return '正在检查技术问答服务，请稍候。';
  }
  if (state.serviceStatus === 'ready') {
    if (activeTurnInfo) {
      return `“${activeTurnInfo.thread.title}” 正在生成回答，可切换线程或等待完成。`;
    }
    return '服务已就绪，历史与引用会保留在当前工作区。';
  }
  return undefined;
}

function getEvidenceState(outcome: QaTerminalOutcome | undefined): QaEvidenceState | undefined {
  if (!outcome || !('evidenceState' in outcome)) return undefined;
  return outcome.evidenceState;
}

function getTurnStatusLabel(turn: QaTranscriptTurn): string {
  switch (turn.state.status) {
    case 'idle': return '等待中';
    case 'loading': return '检索证据';
    case 'streaming': return '回答中';
    case 'answer': return '已回答';
    case 'follow_up': return '需要补充';
    case 'refusal': return turn.state.outcome?.kind === 'refusal' && turn.state.outcome.evidenceState === 'conflicting'
      ? '证据冲突'
      : '证据不足';
    case 'error': return '回答失败';
    case 'cancelled': return '已取消';
    case 'protocol_error': return '响应异常';
  }
}

function getSubmitDisabledReason(state: TechnicalQaState, hasActiveTurn: boolean): string {
  if (state.serviceStatus === 'checking') return '正在检查服务状态';
  if (state.serviceStatus === 'unavailable') return '服务不可用';
  if (state.submitting || hasActiveTurn) return '当前有回答正在生成，完成后可继续提问';
  if (!state.draft.trim()) return '输入问题后再提问';
  return '';
}

function getAuthorityColor(authority: QaSourceAuthority): 'blue' | 'green' | 'gold' | 'default' {
  if (authority === 'official') return 'blue';
  if (authority === 'maintainer') return 'green';
  if (authority === 'curated') return 'gold';
  return 'default';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
