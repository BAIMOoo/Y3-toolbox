import type { QaAnswerOutcomeV2, QaCitation, QaEvent, QaEventPage, QaTerminalOutcome } from './types';

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

function answerV2Page(
  outcome: QaAnswerOutcomeV2,
  deltas: string[] = [],
  ids: { threadId: string; turnId: string; eventPrefix: string } = {
    threadId: 'thread-v2-fixture',
    turnId: 'turn-v2-fixture',
    eventPrefix: 'event-v2',
  },
): QaEventPage {
  const events: QaEvent[] = [
    {
      schemaVersion: 1,
      eventId: `${ids.eventPrefix}-accepted`,
      threadId: ids.threadId,
      turnId: ids.turnId,
      sequence: 1,
      type: 'turn.accepted',
      createdAt: CREATED_AT,
      payload: { type: 'turn.accepted' },
    },
    {
      schemaVersion: 1,
      eventId: `${ids.eventPrefix}-retrieval-started`,
      threadId: ids.threadId,
      turnId: ids.turnId,
      sequence: 2,
      type: 'retrieval.started',
      createdAt: CREATED_AT,
      payload: { type: 'retrieval.started' },
    },
    {
      schemaVersion: 1,
      eventId: `${ids.eventPrefix}-retrieval-completed`,
      threadId: ids.threadId,
      turnId: ids.turnId,
      sequence: 3,
      type: 'retrieval.completed',
      createdAt: CREATED_AT,
      payload: {
        type: 'retrieval.completed',
        evidenceState: outcome.evidenceState,
        sourceCount: outcome.citations.length,
      },
    },
    ...deltas.map((delta, index) => ({
      schemaVersion: 1 as const,
      eventId: `${ids.eventPrefix}-delta-${index + 1}`,
      threadId: ids.threadId,
      turnId: ids.turnId,
      sequence: 4 + index,
      type: 'answer.delta' as const,
      createdAt: CREATED_AT,
      payload: { type: 'answer.delta' as const, delta },
    })),
  ];
  events.push({
    schemaVersion: 1,
    eventId: `${ids.eventPrefix}-completed`,
    threadId: ids.threadId,
    turnId: ids.turnId,
    sequence: events.length + 1,
    type: 'turn.completed',
    createdAt: CREATED_AT,
    payload: { type: 'turn.completed', outcome },
  });
  return {
    schemaVersion: 1,
    threadId: ids.threadId,
    turnId: ids.turnId,
    events,
    nextCursor: events.length,
    terminal: true,
  };
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
  answerV2: answerV2Page(
    {
      kind: 'answer',
      outcomeSchemaVersion: 2,
      answer: 'Use y3.timer.loop for repeated callbacks. If callback cost is high, infer that a longer interval is safer.',
      evidenceState: 'sufficient',
      answerBasis: 'mixed',
      supportSegments: [
        {
          text: 'Use y3.timer.loop for repeated callbacks. ',
          basis: 'grounded',
          citationIds: ['citation-lua-timer'],
        },
        {
          text: 'If callback cost is high, infer that a longer interval is safer.',
          basis: 'inference',
          citationIds: [],
        },
      ],
      citations: [luaCitation],
      notices: [
        { kind: 'knowledge_unavailable' },
        { kind: 'source_unavailable' },
      ],
    },
    [
      'Use y3.timer.loop for repeated callbacks. ',
      'If callback cost is high, infer that a longer interval is safer.',
    ],
  ),
  answerV2InvalidSegmentConcat: answerV2Page(
    {
      kind: 'answer',
      outcomeSchemaVersion: 2,
      answer: 'Use y3.timer.loop for repeated callbacks.',
      evidenceState: 'sufficient',
      answerBasis: 'mixed',
      supportSegments: [
        {
          text: 'Use y3.timer.loop for repeated callbacks.',
          basis: 'grounded',
          citationIds: ['citation-lua-timer'],
        },
        {
          text: ' Extra unsupported text.',
          basis: 'inference',
          citationIds: [],
        },
      ],
      citations: [luaCitation],
      notices: [],
    },
    ['Use y3.timer.loop for repeated callbacks.'],
    { threadId: 'thread-v2-invalid-fixture', turnId: 'turn-v2-invalid-fixture', eventPrefix: 'event-v2-invalid' },
  ),
} as const;
