import type { QaCitation, QaEvent, QaEventPage, QaTerminalOutcome } from './types';

export type QaTurnStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'answer'
  | 'follow_up'
  | 'refusal'
  | 'error'
  | 'cancelled'
  | 'protocol_error';

export interface QaTurnState {
  threadId?: string;
  turnId?: string;
  status: QaTurnStatus;
  answerText: string;
  citations: QaCitation[];
  outcome?: QaTerminalOutcome;
  lastSequence: number;
  terminal: boolean;
  protocolError?: string;
  seenEventIds: Record<string, string>;
  seenSequences: Record<number, string>;
}

export function createInitialQaTurnState(): QaTurnState {
  return {
    status: 'idle',
    answerText: '',
    citations: [],
    lastSequence: 0,
    terminal: false,
    seenEventIds: {},
    seenSequences: {},
  };
}

function eventFingerprint(event: QaEvent): string {
  return JSON.stringify({
    eventId: event.eventId,
    threadId: event.threadId,
    turnId: event.turnId,
    sequence: event.sequence,
    type: event.type,
    createdAt: event.createdAt,
    payload: event.payload,
  });
}

function failProtocol(state: QaTurnState, message: string): QaTurnState {
  return { ...state, status: 'protocol_error', terminal: true, protocolError: message };
}

function terminalStatus(outcome: QaTerminalOutcome): QaTurnStatus {
  return outcome.kind;
}

export function reduceQaEvent(state: QaTurnState, event: QaEvent): QaTurnState {
  const fingerprint = eventFingerprint(event);
  const priorFingerprint = state.seenEventIds[event.eventId];
  if (priorFingerprint) {
    return priorFingerprint === fingerprint ? state : failProtocol(state, `Conflicting duplicate eventId ${event.eventId}.`);
  }

  const priorSequenceEventId = state.seenSequences[event.sequence];
  if (priorSequenceEventId) {
    return failProtocol(state, `Sequence ${event.sequence} was already assigned to ${priorSequenceEventId}.`);
  }
  if (event.schemaVersion !== 1) return failProtocol(state, 'Unsupported QA event schemaVersion.');
  if (event.type !== event.payload.type) return failProtocol(state, 'QA event type does not match payload type.');
  if (state.terminal) return failProtocol(state, 'QA event arrived after the terminal event.');
  if (event.sequence !== state.lastSequence + 1) {
    return failProtocol(state, `Expected QA event sequence ${state.lastSequence + 1}, received ${event.sequence}.`);
  }
  if ((state.threadId && event.threadId !== state.threadId) || (state.turnId && event.turnId !== state.turnId)) {
    return failProtocol(state, 'QA event identifiers changed within a turn.');
  }

  const next: QaTurnState = {
    ...state,
    threadId: event.threadId,
    turnId: event.turnId,
    lastSequence: event.sequence,
    seenEventIds: { ...state.seenEventIds, [event.eventId]: fingerprint },
    seenSequences: { ...state.seenSequences, [event.sequence]: event.eventId },
  };

  switch (event.payload.type) {
    case 'turn.accepted':
    case 'retrieval.started':
    case 'retrieval.completed':
      return { ...next, status: 'loading' };
    case 'answer.delta':
      return { ...next, status: 'streaming', answerText: next.answerText + event.payload.delta };
    case 'turn.completed': {
      const outcome = event.payload.outcome;
      if (outcome.kind === 'answer' && next.answerText && outcome.answer !== next.answerText) {
        return failProtocol(next, 'Terminal answer does not match accumulated answer deltas.');
      }
      return {
        ...next,
        status: terminalStatus(outcome),
        answerText: outcome.kind === 'answer' ? outcome.answer : next.answerText,
        citations: 'citations' in outcome ? outcome.citations : [],
        outcome,
        terminal: true,
      };
    }
  }
}

export function reduceQaEventPage(state: QaTurnState, page: QaEventPage): QaTurnState {
  if (page.schemaVersion !== 1) return failProtocol(state, 'Unsupported QA event page schemaVersion.');
  if ((state.threadId && page.threadId !== state.threadId) || (state.turnId && page.turnId !== state.turnId)) {
    return failProtocol(state, 'QA event page identifiers do not match the active turn.');
  }

  let next = state;
  for (const event of page.events) {
    if (event.threadId !== page.threadId || event.turnId !== page.turnId) {
      return failProtocol(next, 'QA event identifiers do not match the containing page.');
    }
    next = reduceQaEvent(next, event);
    if (next.status === 'protocol_error') return next;
  }
  if (page.nextCursor !== next.lastSequence) return failProtocol(next, 'QA event page cursor is not contiguous.');
  if (page.terminal !== next.terminal) return failProtocol(next, 'QA event page terminal flag is inconsistent.');
  return next;
}
