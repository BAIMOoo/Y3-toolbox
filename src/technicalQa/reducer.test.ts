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

  it('accepts additive v2 answer outcomes while preserving v1 event and page schemas', () => {
    const page = QA_CLIENT_EVENT_FIXTURES.answerV2;
    const state = reduceQaEventPage(createInitialQaTurnState(), page);

    expect(page.schemaVersion).toBe(1);
    expect(page.events.every((event) => event.schemaVersion === 1)).toBe(true);
    expect(state.status).toBe('answer');
    expect(state.answerText).toBe(state.outcome?.kind === 'answer' ? state.outcome.answer : '');
    expect(state.answerText).toBe(
      'Use y3.timer.loop for repeated callbacks. If callback cost is high, infer that a longer interval is safer.',
    );
    expect(state.outcome).toMatchObject({
      kind: 'answer',
      outcomeSchemaVersion: 2,
      answerBasis: 'mixed',
      supportSegments: [
        { text: 'Use y3.timer.loop for repeated callbacks. ', basis: 'grounded', citationIds: ['citation-lua-timer'] },
        { text: 'If callback cost is high, infer that a longer interval is safer.', basis: 'inference', citationIds: [] },
      ],
    });
    expect(state.citations).toHaveLength(1);
    expect(state.terminal).toBe(true);
  });

  it('rejects v2 answers whose support segments do not exactly concatenate to the plain answer', () => {
    const state = reduceQaEventPage(createInitialQaTurnState(), QA_CLIENT_EVENT_FIXTURES.answerV2InvalidSegmentConcat);

    expect(state.status).toBe('protocol_error');
    expect(state.protocolError).toMatch(/support segments.*answer/i);
  });

  it('rejects v2 answers whose answer and support-segment text are whitespace-only', () => {
    const page = structuredClone(QA_CLIENT_EVENT_FIXTURES.answerV2);
    const terminalEvent = page.events.at(-1);
    const outcome = terminalEvent?.payload.type === 'turn.completed' ? terminalEvent.payload.outcome : null;
    if (!outcome || outcome.kind !== 'answer' || !('outcomeSchemaVersion' in outcome)) {
      throw new Error('expected v2 answer fixture');
    }
    outcome.answer = '   ';
    outcome.answerBasis = 'inference';
    outcome.evidenceState = 'insufficient';
    outcome.supportSegments = [{ basis: 'inference', text: '   ', citationIds: [] }];
    outcome.citations = [];
    outcome.notices = [];
    let whitespaceDelta = '   ';
    for (const event of page.events) {
      if (event.payload.type === 'answer.delta') {
        event.payload.delta = whitespaceDelta;
        whitespaceDelta = '';
      }
    }

    const state = reduceQaEventPage(createInitialQaTurnState(), page);

    expect(state.status).toBe('protocol_error');
    expect(state.protocolError).toMatch(/answer must not be empty/i);
  });

  it('rejects malformed v2 returned citation ids and support-segment citation references', () => {
    for (const malformedId of ['', ' citation-lua-timer', 'citation-lua-timer ', 'citation\nlua', 'c'.repeat(129)]) {
      const returnedIdPage = structuredClone(QA_CLIENT_EVENT_FIXTURES.answerV2);
      const returnedIdTerminalEvent = returnedIdPage.events.at(-1);
      const returnedIdOutcome = returnedIdTerminalEvent?.payload.type === 'turn.completed'
        ? returnedIdTerminalEvent.payload.outcome
        : null;
      if (!returnedIdOutcome || returnedIdOutcome.kind !== 'answer' || !('outcomeSchemaVersion' in returnedIdOutcome)) {
        throw new Error('expected v2 answer fixture');
      }
      returnedIdOutcome.citations[0]!.citationId = malformedId;
      const returnedIdState = reduceQaEventPage(createInitialQaTurnState(), returnedIdPage);
      expect(returnedIdState.status).toBe('protocol_error');
      expect(returnedIdState.protocolError).toMatch(/citation identifiers/i);

      const supportRefPage = structuredClone(QA_CLIENT_EVENT_FIXTURES.answerV2);
      const supportRefTerminalEvent = supportRefPage.events.at(-1);
      const supportRefOutcome = supportRefTerminalEvent?.payload.type === 'turn.completed'
        ? supportRefTerminalEvent.payload.outcome
        : null;
      if (!supportRefOutcome || supportRefOutcome.kind !== 'answer' || !('outcomeSchemaVersion' in supportRefOutcome)) {
        throw new Error('expected v2 answer fixture');
      }
      supportRefOutcome.supportSegments[0]!.citationIds = [malformedId];
      const supportRefState = reduceQaEventPage(createInitialQaTurnState(), supportRefPage);
      expect(supportRefState.status).toBe('protocol_error');
      expect(supportRefState.protocolError).toMatch(/citationIds.*valid citation identifiers/i);
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
