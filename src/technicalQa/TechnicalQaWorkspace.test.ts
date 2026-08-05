// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QaThreadSession, TechnicalQaController, TechnicalQaState } from './TechnicalQaWorkspace';
import { createInitialQaTurnState, type QaTurnState } from './reducer';
import { TechnicalQaWorkspaceView } from './TechnicalQaWorkspace';
import type { QaDomain, QaTerminalOutcome } from './types';

vi.mock('antd', () => ({
  Button: ({ children, disabled, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    React.createElement('button', { ...props, disabled, onClick }, children)
  ),
  Segmented: ({ value, options, onChange, disabled }: {
    value: string;
    options: Array<{ label: string; value: string }>;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => React.createElement('div', { role: 'group', 'aria-label': 'domain' }, options.map((option) => (
    React.createElement('button', {
      key: option.value,
      type: 'button',
      disabled,
      'aria-pressed': option.value === value,
      onClick: () => onChange(option.value),
    }, option.label)
  ))),
  Tag: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
  Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@ant-design/icons', () => ({
  BookOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'book'),
  PlusOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'plus'),
  ReloadOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'reload'),
  SendOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'send'),
  StopOutlined: () => React.createElement('span', { 'aria-hidden': 'true' }, 'stop'),
}));

afterEach(() => cleanup());

describe('TechnicalQaWorkspaceView', () => {
  it('renders fixed scope controls, keeps multiline input editable, and submits with Ctrl+Enter', () => {
    const controller = controllerDouble();
    const state = stateWith([]);
    state.draft = 'How do I inspect the event path?';
    const { container } = renderWorkspace(state, controller);

    expect(screen.getByText('Y3 2.0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ECA / 编辑器' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/provider|model|project path/i)).toBeNull();
    expect(screen.getByText('服务已就绪，历史与引用会保留在当前工作区。')).toBeTruthy();
    expect(container.querySelector('.technical-qa__transcript')).not.toHaveAttribute('aria-live');

    const composer = screen.getByRole('textbox', { name: '技术问题' });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(controller.submit).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
    expect(controller.submit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Lua / y3-lualib' }));
    expect(controller.setDomain).toHaveBeenCalledWith('lua_y3_lualib');
  });

  it('renders streaming and answer provenance with explicit evidence state', () => {
    const streaming = turnState('streaming');
    streaming.answerText = '正在生成的回答';
    const answer = terminalState({
      kind: 'answer',
      answer: '使用触发器事件。',
      evidenceState: 'sufficient',
      citations: [{
        citationId: 'citation-1',
        sourceId: 'source-1',
        title: 'Y3 Editor 2.0 Trigger Documentation',
        sourceKind: 'editor_documentation',
        authority: 'official',
        locator: 'Triggers > Events',
        versionScope: 'Y3 2.0',
        excerpt: 'Event responses are configured on the trigger.',
      }],
    });
    renderWorkspace(stateWith([
      thread('thread-1', [turn('q-1', streaming), turn('q-2', answer)], '主会话'),
    ]));

    expect(screen.getByText('正在生成的回答')).toBeTruthy();
    expect(screen.getByText('使用触发器事件。')).toBeTruthy();
    expect(screen.getByText('证据充分')).toBeTruthy();
    expect(screen.getByRole('region', { name: '引用来源' })).toBeTruthy();
    expect(screen.getByText('Y3 Editor 2.0 Trigger Documentation')).toBeTruthy();
    expect(screen.getByText('官方')).toBeTruthy();
    expect(screen.getByText('Triggers > Events')).toBeTruthy();
  });

  it.each([
    ['follow_up', { kind: 'follow_up', prompt: '请补充准确的 API 符号。', missingInformation: ['API 符号'], evidenceState: 'insufficient', citations: [] }],
    ['refusal', { kind: 'refusal', code: 'insufficient_evidence', message: '证据不足，无法给出可靠回答。', evidenceState: 'insufficient', citations: [] }],
    ['cancelled', { kind: 'cancelled', message: '回答已取消。' }],
  ] as Array<[string, QaTerminalOutcome]>)('renders the %s terminal state', (_kind, outcome) => {
    renderWorkspace(stateWith([thread('thread-1', [turn('q-1', terminalState(outcome))], '终态会话')]));

    const expected = outcome.kind === 'follow_up' ? outcome.prompt : outcome.message;
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('offers a retry action for retryable errors and restores the original question into the draft', () => {
    const controller = controllerDouble();
    const errorTurn = terminalState({
      kind: 'error',
      code: 'service_unavailable',
      message: '回答失败，请稍后重试。',
      retryable: true,
    });
    renderWorkspace(stateWith([thread('thread-1', [turn('q-1', errorTurn)], '错误会话')]), controller);

    fireEvent.click(screen.getByRole('button', { name: '重新提问' }));
    expect(controller.setDraft).toHaveBeenCalledWith('问题 q-1');
  });

  it('keeps draft visible, disables submission, and offers a health retry while unavailable', () => {
    const controller = controllerDouble();
    const state = stateWith([]);
    state.draft = '保留中的草稿';
    state.serviceStatus = 'unavailable';
    state.serviceMessage = '当前无法连接问答服务。';
    renderWorkspace(state, controller);

    expect((screen.getByRole('textbox', { name: '技术问题' }) as HTMLTextAreaElement).value).toBe('保留中的草稿');
    expect((screen.getByRole('button', { name: /提问/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /重新检查/ }));
    expect(controller.refreshHealth).toHaveBeenCalledOnce();
  });

  it('disables composer actions when another thread is still streaming', () => {
    const controller = controllerDouble();
    const state = stateWith([
      thread('active-thread', [turn('q-1', turnState('loading'))], '后台会话'),
      thread('current-thread', [], '当前会话'),
    ]);
    state.activeThreadKey = 'current-thread';
    state.draft = '需要提问的新问题';
    renderWorkspace(state, controller);

    expect(screen.getByText('“后台会话” 正在生成回答，可切换线程或等待完成。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消回答' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'ECA / 编辑器' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '提问' })).toBeNull();
  });
});

function renderWorkspace(state: TechnicalQaState, controller = controllerDouble()) {
  return render(React.createElement(TechnicalQaWorkspaceView, { state, controller }));
}

function stateWith(threads: QaThreadSession[]): TechnicalQaState {
  const availableThreads = threads.length > 0 ? threads : [thread('thread-empty', [])];
  return {
    threads: availableThreads,
    activeThreadKey: availableThreads[0]!.key,
    draft: '',
    domain: 'eca_editor',
    serviceStatus: 'ready',
    submitting: false,
  };
}

function thread(key: string, turns: QaThreadSession['turns'], title = turns[0]?.question ?? '新问题'): QaThreadSession {
  return {
    key,
    threadId: `server-${key}`,
    title,
    createdAt: '2026-08-05T09:00:00.000Z',
    updatedAt: '2026-08-05T09:01:00.000Z',
    turns,
  };
}

function turn(clientRequestId: string, state: QaTurnState, domain: QaDomain = 'eca_editor') {
  return {
    clientRequestId,
    question: `问题 ${clientRequestId}`,
    domain,
    submittedAt: '2026-08-05T09:00:00.000Z',
    state,
  };
}

function turnState(status: QaTurnState['status']): QaTurnState {
  return { ...createInitialQaTurnState(), status };
}

function terminalState(outcome: QaTerminalOutcome): QaTurnState {
  return {
    ...createInitialQaTurnState(),
    status: outcome.kind,
    terminal: true,
    outcome,
    answerText: outcome.kind === 'answer' ? outcome.answer : '',
    citations: 'citations' in outcome ? outcome.citations : [],
  };
}

function controllerDouble(): TechnicalQaController {
  return {
    submit: vi.fn().mockResolvedValue(undefined),
    setDraft: vi.fn(),
    setDomain: vi.fn(),
    selectThread: vi.fn(),
    startNewThread: vi.fn(),
    cancelActiveTurn: vi.fn().mockResolvedValue(undefined),
    refreshHealth: vi.fn().mockResolvedValue(undefined),
  } as unknown as TechnicalQaController;
}
