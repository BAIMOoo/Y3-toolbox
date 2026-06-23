import { describe, expect, it } from 'vitest';
import { formatAgentJobListTime } from './formatAgentJobListTime';

describe('formatAgentJobListTime', () => {
  it('renders task list submission time with Chinese year-month-day and hour-minute', () => {
    expect(formatAgentJobListTime('2026-06-23T14:05:00')).toBe('2026年06月23日 14:05');
  });

  it('renders ISO runner timestamps in the viewer local timezone', () => {
    const runnerTimestamp = '2026-06-23T06:05:00.000Z';

    expect(formatAgentJobListTime(runnerTimestamp)).toBe(formatExpectedLocalDateTime(new Date(runnerTimestamp)));
  });

  it('keeps invalid timestamps empty instead of throwing or showing misleading text', () => {
    expect(formatAgentJobListTime('not-a-date')).toBe('');
  });
});

function formatExpectedLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}
