import type { QaCitation, QaEvent, QaEventPage, QaTerminalOutcome } from './types';

const CREATED_AT = '2026-08-05T09:00:00.000Z';

const ecaCitation: QaCitation = {
  citationId: 'citation-eca-trigger',
  sourceId: 'source-eca-trigger',
  title: 'Y3 Editor 2.0 Trigger Documentation',
  sourceKind: 'editor_documentation',
  authority: 'official',
  locator: 'Triggers > Event responses',
  versionScope: 'Y3 2.0',
};

const luaCitation: QaCitation = {
  citationId: 'citation-lua-timer',
  sourceId: 'source-lua-timer',
  title: 'y3-lualib Timer API',
  sourceKind: 'maintained_source',
  authority: 'maintainer',
  locator: 'y3.timer.loop',
  versionScope: 'Y3 2.0',
};

function event(sequence: number, payload: QaEvent['payload'], id: string): QaEvent {
  return {
    schemaVersion: 1,
    eventId: id,
    threadId: 'thread-fixture',
    turnId: 'turn-fixture',
    sequence,
    type: payload.type,
    createdAt: CREATED_AT,
    payload,
  };
}

function page(outcome: QaTerminalOutcome, deltas: string[] = []): QaEventPage {
  const events: QaEvent[] = [
    event(1, { type: 'turn.accepted' }, 'event-accepted'),
    event(2, { type: 'retrieval.started' }, 'event-retrieval-started'),
    event(3, {
      type: 'retrieval.completed',
      evidenceState: 'evidenceState' in outcome ? outcome.evidenceState : 'insufficient',
      sourceCount: 'citations' in outcome ? outcome.citations.length : 0,
    }, 'event-retrieval-completed'),
    ...deltas.map((delta, index) => event(4 + index, { type: 'answer.delta', delta }, `event-delta-${index + 1}`)),
  ];
  events.push(event(events.length + 1, { type: 'turn.completed', outcome }, 'event-completed'));
  return { schemaVersion: 1, threadId: 'thread-fixture', turnId: 'turn-fixture', events, nextCursor: events.length, terminal: true };
}

export const QA_CLIENT_EVENT_FIXTURES = {
  ecaAnswer: page(
    { kind: 'answer', answer: 'Create an ECA trigger for the event.', evidenceState: 'sufficient', citations: [ecaCitation] },
    ['Create an ECA ', 'trigger for the event.'],
  ),
  luaAnswer: page(
    { kind: 'answer', answer: 'Use the maintained timer loop API.', evidenceState: 'sufficient', citations: [luaCitation] },
    ['Use the maintained ', 'timer loop API.'],
  ),
  ambiguousFollowUp: page({
    kind: 'follow_up',
    prompt: 'Which exact event or API symbol is involved?',
    missingInformation: ['event or API symbol'],
    evidenceState: 'insufficient',
    citations: [],
  }),
  conflictingRefusal: page({
    kind: 'refusal',
    code: 'conflicting_evidence',
    message: 'The highest-authority evidence conflicts.',
    evidenceState: 'conflicting',
    citations: [ecaCitation],
  }),
  underEvidencedRefusal: page({
    kind: 'refusal',
    code: 'insufficient_evidence',
    message: 'There is not enough Y3 2.0 evidence to answer.',
    evidenceState: 'insufficient',
    citations: [],
  }),
  forbiddenRefusal: page({
    kind: 'refusal',
    code: 'forbidden_capability',
    message: 'Technical QA cannot read or modify a project directory.',
    evidenceState: 'insufficient',
    citations: [],
  }),
} as const;
