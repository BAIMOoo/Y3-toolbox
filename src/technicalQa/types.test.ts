import { describe, expect, it } from 'vitest';
import {
  buildQaEventPath,
  type QaPublicErrorCode,
  type QaQuestionRequest,
  type QaTerminalOutcome,
} from './types';

describe('technical QA public wire contract', () => {
  it('freezes the Y3 2.0 request shape without provider or project fields', () => {
    const request: QaQuestionRequest = {
      schemaVersion: 1,
      clientRequestId: 'request-1',
      question: 'How does this ECA event work?',
      scope: { product: 'y3_editor', editorVersion: '2.0', domain: 'eca_editor' },
    };

    expect(Object.keys(request)).toEqual(['schemaVersion', 'clientRequestId', 'question', 'scope']);
    expect(JSON.stringify(request)).not.toMatch(/provider|model|endpoint|token|projectPath|ownerToken/i);
  });

  it('permits only opaque diagnostic upload IDs on a question request', () => {
    const request: QaQuestionRequest = {
      schemaVersion: 1,
      clientRequestId: 'request-1',
      question: 'Diagnose this explicit evidence.',
      scope: { product: 'y3_editor', editorVersion: '2.0', domain: 'eca_editor' },
      diagnosticUploadIds: ['upload_opaque_1'],
    };

    expect(request.diagnosticUploadIds).toEqual(['upload_opaque_1']);
    expect(JSON.stringify(request)).not.toMatch(/(?:file|project|storage)?path|contentBase64|provider|model|url/i);
  });

  it('makes citations non-empty for answer outcomes at compile-time and runtime', () => {
    const outcome: QaTerminalOutcome = {
      kind: 'answer',
      answer: 'Grounded answer.',
      evidenceState: 'sufficient',
      citations: [{
        citationId: 'citation-1',
        sourceId: 'source-1',
        title: 'Y3 Editor 2.0 Documentation',
        sourceKind: 'editor_documentation',
        authority: 'official',
        locator: 'Events > Damage',
        versionScope: 'Y3 2.0',
      }],
    };

    expect(outcome.citations).toHaveLength(1);
  });

  it('includes retrieval infrastructure failure in the public error contract', () => {
    const code: QaPublicErrorCode = 'retrieval_unavailable';

    expect(code).toBe('retrieval_unavailable');
  });

  it('exports the additive v2 answer shape with required notices and segment citation arrays', () => {
    const outcome: QaTerminalOutcome = {
      kind: 'answer',
      outcomeSchemaVersion: 2,
      answer: 'Inference-only answer.',
      evidenceState: 'insufficient',
      answerBasis: 'inference',
      supportSegments: [{ text: 'Inference-only answer.', basis: 'inference', citationIds: [] }],
      citations: [],
      notices: [{ kind: 'knowledge_unavailable' }],
    };

    expect(outcome.citations).toHaveLength(0);
    expect(outcome.notices[0]?.kind).toBe('knowledge_unavailable');
    expect(outcome.supportSegments[0]?.citationIds).toEqual([]);
  });

  it('builds only the strict QA turn polling path and rejects malformed cursors', () => {
    expect(buildQaEventPath({ schemaVersion: 1, threadId: 'thread / 1', turnId: 'turn?1', after: 2 })).toBe(
      '/api/qa/threads/thread%20%2F%201/turns/turn%3F1/events?after=2',
    );
    expect(() => buildQaEventPath({ schemaVersion: 1, threadId: 'thread', turnId: 'turn', after: -1 })).toThrow(
      'Invalid QA event cursor.',
    );
    expect(buildQaEventPath({ schemaVersion: 1, threadId: 'thread', turnId: 'turn', after: 0 })).not.toMatch(
      /agent-jobs|ownerToken|token=/i,
    );
  });
});
