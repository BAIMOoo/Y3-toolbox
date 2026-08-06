import { describe, expect, it } from 'vitest';
import { QA_CLIENT_EVENT_FIXTURES } from './fixtures';
import { createInitialQaTurnState, reduceQaEvent, reduceQaEventPage } from './reducer';

describe('technical QA transport-neutral event reducer', () => {
  it('converges on supported ECA and Lua answers with citations', () => {
    for (const page of [QA_CLIENT_EVENT_FIXTURES.ecaAnswer, QA_CLIENT_EVENT_FIXTURES.luaAnswer]) {
      const state = reduceQaEventPage(createInitialQaTurnState(), page);
      expect(state.status).toBe('answer');
      expect(state.answerText).toBe(state.outcome?.kind === 'answer' ? state.outcome.answer : '');
      expect(state.citations.length).toBeGreaterThan(0);
      expect(state.terminal).toBe(true);
    }
  });

  it('converges on follow-up and refusal outcomes without fabricating an answer', () => {
    for (const page of [
      QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp,
      QA_CLIENT_EVENT_FIXTURES.conflictingRefusal,
      QA_CLIENT_EVENT_FIXTURES.underEvidencedRefusal,
      QA_CLIENT_EVENT_FIXTURES.forbiddenRefusal,
    ]) {
      const state = reduceQaEventPage(createInitialQaTurnState(), page);
      expect(['follow_up', 'refusal']).toContain(state.status);
      expect(state.answerText).toBe('');
      expect(state.terminal).toBe(true);
    }
  });

  it('treats exact duplicate delivery as an idempotent no-op', () => {
    const firstEvent = QA_CLIENT_EVENT_FIXTURES.ecaAnswer.events[0]!;
    const state = reduceQaEvent(createInitialQaTurnState(), firstEvent);
    expect(reduceQaEvent(state, firstEvent)).toBe(state);
  });

  it('fails closed on conflicting duplicates, gaps, and out-of-order events', () => {
    const firstEvent = QA_CLIENT_EVENT_FIXTURES.ecaAnswer.events[0]!;
    const state = reduceQaEvent(createInitialQaTurnState(), firstEvent);
    const conflictingDuplicate = { ...firstEvent, payload: { type: 'retrieval.started' as const } };
    expect(reduceQaEvent(state, conflictingDuplicate).status).toBe('protocol_error');

    const gapEvent = QA_CLIENT_EVENT_FIXTURES.ecaAnswer.events[2]!;
    const gapState = reduceQaEvent(state, gapEvent);
    expect(gapState.status).toBe('protocol_error');
    expect(gapState.lastSequence).toBe(1);
  });

  it('rejects answer mismatches and post-terminal events without corrupting accumulated text', () => {
    const page = QA_CLIENT_EVENT_FIXTURES.ecaAnswer;
    let state = createInitialQaTurnState();
    for (const event of page.events.slice(0, -1)) state = reduceQaEvent(state, event);
    const accumulated = state.answerText;
    const completed = page.events.at(-1)!;
    if (completed.payload.type !== 'turn.completed' || completed.payload.outcome.kind !== 'answer') {
      throw new Error('expected answer completion fixture');
    }
    const mismatched = {
      ...completed,
      payload: {
        type: 'turn.completed' as const,
        outcome: { ...completed.payload.outcome, answer: 'Different answer.' },
      },
    };
    const failed = reduceQaEvent(state, mismatched);
    expect(failed.status).toBe('protocol_error');
    expect(failed.answerText).toBe(accumulated);

    const terminal = reduceQaEventPage(createInitialQaTurnState(), page);
    const postTerminal = { ...page.events[0]!, eventId: 'event-after-terminal', sequence: terminal.lastSequence + 1 };
    expect(reduceQaEvent(terminal, postTerminal).status).toBe('protocol_error');
  });

  it('rejects inconsistent page cursor and terminal metadata', () => {
    const page = QA_CLIENT_EVENT_FIXTURES.ambiguousFollowUp;
    expect(reduceQaEventPage(createInitialQaTurnState(), { ...page, nextCursor: page.nextCursor - 1 }).status).toBe(
      'protocol_error',
    );
    expect(reduceQaEventPage(createInitialQaTurnState(), { ...page, terminal: false }).status).toBe('protocol_error');
  });
});
