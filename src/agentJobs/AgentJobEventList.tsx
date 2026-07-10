import React, { type RefObject } from 'react';
import { Tag } from 'antd';
import type { AgentJobEvent, AgentJobEventType } from './types';
import { filterUserVisibleJobEvents } from './eventVisibility';
import { splitReadableMessage } from './readableMessage';

interface AgentJobEventListProps {
  events: AgentJobEvent[];
  emptyMessage: string;
  logEndRef?: RefObject<HTMLDivElement | null>;
}

export function AgentJobEventList({ events, emptyMessage, logEndRef }: AgentJobEventListProps) {
  const visibleEvents = filterUserVisibleJobEvents(events);
  if (visibleEvents.length === 0) {
    return (
      <React.Fragment>
        <span className="agent-job-empty-events">{emptyMessage}</span>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <div className="agent-job-event-list" role="log" aria-live="polite" aria-label="Agent job event log">
        {visibleEvents.map((event) => (
          <div key={event.id} className={`agent-job-event agent-job-event--${event.type} ${event.stream ? `agent-job-event--${event.stream}` : ''}`}>
            <span className="agent-job-event-meta">
              <span className="agent-job-event-time">{formatEventTime(event.createdAt)}</span>
              <span className="agent-job-event-tags">
                <Tag color={eventTagColor(event.type)}>{event.type}</Tag>
                {event.stream && <Tag>{event.stream}</Tag>}
              </span>
            </span>
            <span className="agent-job-event-message" aria-label={event.message}>
              {splitReadableMessage(event.message).map((segment, index) => (
                <span key={`${event.id}-${index}`} className="agent-job-readable-line">{segment}</span>
              ))}
            </span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </React.Fragment>
  );
}

function eventTagColor(type: AgentJobEventType): string {
  if (type === 'failed') return 'error';
  if (type === 'succeeded') return 'success';
  if (type === 'progress') return 'blue';
  if (type === 'agent-output') return 'default';
  if (type === 'recovery') return 'warning';
  return 'processing';
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}
