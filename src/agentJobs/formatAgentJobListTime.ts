export function formatAgentJobListTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // The runner emits ISO-8601 timestamps; task-list submission times are shown
  // in the viewer's local timezone for consistency with the previous time-only UI.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}
