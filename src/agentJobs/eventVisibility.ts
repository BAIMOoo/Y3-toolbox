import type { AgentJobEvent } from './types';

export function isUserVisibleJobEvent(event: AgentJobEvent): boolean {
  return event.type !== 'agent-output';
}

export function filterUserVisibleJobEvents(events: AgentJobEvent[]): AgentJobEvent[] {
  return events.filter(isUserVisibleJobEvent);
}
