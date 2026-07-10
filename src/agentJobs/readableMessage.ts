const MESSAGE_BREAK_PATTERN = /([。；;，,])\s*/g;
const KEYWORD_BREAK_PATTERN = /\s+(?=(?:验证|完成|错误|失败|警告|附件|下载包|产物|decoded_digest|digest_source|PowerShell)[:：=])/g;
const MAX_SEGMENT_LENGTH = 88;
const DIAGNOSTIC_SEGMENT_PATTERN = /(?:decoded_digest|digest_source|helper\s*摘要|record_count|scene_directory_count|digest_json_count|PowerShell|退出码|验证[:：])/i;

export function splitReadableMessage(message: string): string[] {
  return message
    .split(/\r?\n/)
    .flatMap((line) => splitLineByPunctuation(line))
    .flatMap((segment) => splitLongSegment(segment))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function summarizeReadableMessage(message: string): string[] {
  const mismatchSummary = summarizeMismatchLogMessage(message);
  if (mismatchSummary.length > 0) return mismatchSummary;

  const coreSegments = splitReadableMessage(message).filter((segment) => !DIAGNOSTIC_SEGMENT_PATTERN.test(segment));
  return dedupeSegments(coreSegments).slice(0, 4);
}

function summarizeMismatchLogMessage(message: string): string[] {
  if (!message.includes('不同步日志')) return [];

  const mapId = firstCapture(message, /地图\s*(\d+)/);
  const days = firstCapture(message, /最近\s*(\d+)\s*天/);
  const recordCount = firstCapture(message, /记录数\s*[:：]?\s*(\d+)/) ?? firstCapture(message, /(\d+)\s*条记录/);
  const packageCount = firstCapture(message, /生成\s*(\d+)\s*个下载包/) ?? firstCapture(message, /(\d+)\s*个附件/);
  const isComplete = /(?:拉取完成|已拉取|完成)/.test(message);

  if (!mapId && !days && recordCount === undefined && packageCount === undefined) return [];

  const titleParts = [mapId ? `地图 ${mapId}` : undefined, days ? `最近 ${days} 天` : undefined].filter(Boolean);
  const title = `${titleParts.length > 0 ? `${titleParts.join(' · ')}不同步日志` : '不同步日志'}${isComplete ? '拉取完成' : ''}`;
  const summary = [title];

  if (recordCount !== undefined) summary.push(`${recordCount} 条不同步记录`);
  if (packageCount !== undefined) summary.push(`${packageCount} 个下载包已生成`);

  return summary;
}

function firstCapture(value: string, pattern: RegExp): string | undefined {
  return pattern.exec(value)?.[1];
}

function dedupeSegments(segments: string[]): string[] {
  return [...new Set(segments.map((segment) => segment.trim()).filter(Boolean))];
}

function splitLineByPunctuation(line: string): string[] {
  return line
    .trim()
    .replace(MESSAGE_BREAK_PATTERN, '$1\n')
    .replace(KEYWORD_BREAK_PATTERN, '\n')
    .split('\n');
}

function splitLongSegment(segment: string): string[] {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1 || segment.length <= MAX_SEGMENT_LENGTH) return [segment];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > MAX_SEGMENT_LENGTH && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}
