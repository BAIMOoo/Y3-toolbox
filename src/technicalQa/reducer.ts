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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isValidQaCitationId(value: string): boolean {
  return value.length > 0
    && value.length <= 128
    && value === value.trim()
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });
}

function validateTerminalOutcome(outcome: QaTerminalOutcome): string | null {
  if (outcome.kind !== 'answer' || !('outcomeSchemaVersion' in outcome) || outcome.outcomeSchemaVersion !== 2) {
    return null;
  }

  if (!outcome.answer.trim()) return 'V2 answer must not be empty.';
  if (!['conversation', 'grounded', 'mixed', 'inference'].includes(outcome.answerBasis)) {
    return 'Unsupported v2 answer basis.';
  }
  if (!Array.isArray(outcome.supportSegments)) return 'V2 answer support segments must be an array.';
  if (!Array.isArray(outcome.citations)) return 'V2 answer citations must be an array.';
  if (!Array.isArray(outcome.notices)) return 'V2 answer notices must be an array.';
  if (outcome.supportSegments.length === 0) return 'V2 answer support segments must not be empty.';

  const segmentText = outcome.supportSegments.map((segment) => (isRecord(segment) ? segment.text : '')).join('');
  if (segmentText !== outcome.answer) {
    return 'V2 answer support segments must exactly concatenate to the plain answer.';
  }

  const citationIds = new Set<string>();
  for (const citation of outcome.citations) {
    if (!isRecord(citation) || typeof citation.citationId !== 'string' || !isValidQaCitationId(citation.citationId)) {
      return 'V2 answer citations must include citation identifiers.';
    }
    if (citationIds.has(citation.citationId)) return `Duplicate v2 answer citation ${citation.citationId}.`;
    citationIds.add(citation.citationId);
  }

  const referencedCitationIds = new Set<string>();
  const segmentBases = new Set<string>();
  let hasInference = false;
  let hasGrounded = false;
  let hasConversation = false;

  for (const segment of outcome.supportSegments) {
    if (!isRecord(segment)) return 'V2 answer support segments must be objects.';
    if (typeof segment.text !== 'string' || !segment.text) {
      return 'V2 answer support segment text must not be empty.';
    }
    if (!Array.isArray(segment.citationIds)) return 'V2 answer support segment citationIds must be an array.';
    if (!segment.citationIds.every((citationId) => typeof citationId === 'string' && isValidQaCitationId(citationId))) {
      return 'V2 answer support segment citationIds must be valid citation identifiers.';
    }
    const segmentCitationIds = segment.citationIds as string[];
    const basis = segment.basis;
    segmentBases.add(String(basis));

    if (basis === 'grounded') {
      hasGrounded = true;
      if (segmentCitationIds.length === 0) {
        return 'V2 grounded support segments must cite at least one source.';
      }
      for (const citationId of segmentCitationIds) {
        if (!citationIds.has(citationId)) return `V2 grounded support segment cites unknown source ${citationId}.`;
        referencedCitationIds.add(citationId);
      }
    } else if (basis === 'inference') {
      hasInference = true;
      if (segmentCitationIds.length > 0) {
        return 'V2 inference support segments must not carry direct citation ids.';
      }
    } else if (basis === 'conversation') {
      hasConversation = true;
      if (segmentCitationIds.length > 0) {
        return 'V2 conversation support segments must not carry direct citation ids.';
      }
    } else {
      return 'Unsupported v2 answer support segment basis.';
    }
  }

  if (outcome.answerBasis === 'conversation' && (hasGrounded || hasInference)) {
    return 'V2 conversation answers must only include conversation support segments.';
  }
  if (outcome.answerBasis === 'grounded' && (hasConversation || hasInference)) {
    return 'V2 grounded answers must only include grounded support segments.';
  }
  if (outcome.answerBasis === 'inference' && (hasConversation || hasGrounded)) {
    return 'V2 inference answers must only include inference support segments.';
  }
  if (outcome.answerBasis === 'mixed' && segmentBases.size < 2) {
    return 'V2 mixed answers must include more than one support basis.';
  }
  for (const citationId of citationIds) {
    if (!referencedCitationIds.has(citationId)) return `V2 answer citation ${citationId} is not referenced.`;
  }

  for (const notice of outcome.notices) {
    if (!isRecord(notice) || (notice.kind !== 'knowledge_unavailable' && notice.kind !== 'source_unavailable')) {
      return 'Unsupported v2 answer notice code.';
    }
  }

  return null;
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
      const outcomeError = validateTerminalOutcome(outcome);
      if (outcomeError) return failProtocol(next, outcomeError);
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
