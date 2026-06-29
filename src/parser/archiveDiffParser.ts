import type { ArchiveChange, ChangeType } from '../types';

interface ArchiveLimitMetadata {
  dayValueOld: string;
  dayValueNew: string;
  maxValue: string;
}

export function extractArchiveDiff(rawText: string): string | null {
  const marker = '"archive_diff":"';
  const start = rawText.indexOf(marker);
  if (start === -1) return null;
  const valueStart = start + marker.length;
  const valueEnd = rawText.indexOf('"', valueStart);
  if (valueEnd === -1) return null;
  return rawText.substring(valueStart, valueEnd);
}

function getChangeType(oldValue: string, newValue: string): ChangeType {
  if (oldValue === 'nil') return 'create';
  if (newValue === 'nil') return 'delete';
  if (oldValue === newValue) return 'noop';
  return 'update';
}

/**
 * Split archive_diff entries while preserving platform metadata blocks.
 *
 * The platform CheckMapArchiveDiff output can append limit metadata to a value:
 *   key=old>>>new[dv:oldDayValue>>newDayValue|max:limit]
 *
 * The pipe inside this bracket is part of the metadata, not an archive_diff
 * entry delimiter. A plain `diffStr.split('|')` would incorrectly produce a
 * fake key such as `max:99999999]`.
 */
function splitArchiveDiffEntries(diffStr: string): string[] {
  const entries: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (const char of diffStr) {
    if (char === '|' && bracketDepth === 0) {
      if (current.length > 0) entries.push(current);
      current = '';
      continue;
    }

    current += char;

    if (char === '[') bracketDepth += 1;
    else if (char === ']' && bracketDepth > 0) bracketDepth -= 1;
  }

  if (current.length > 0) entries.push(current);
  return entries;
}


function decodeUtf8HexEscapes(value: string): string {
  return value.replace(/(?:\\x[0-9a-fA-F]{2})+/g, (sequence) => {
    const bytes = sequence.match(/[0-9a-fA-F]{2}/g)?.map((hex) => Number.parseInt(hex, 16)) ?? [];
    if (bytes.length === 0) return sequence;

    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
      return decoded;
    } catch {
      return sequence;
    }
  });
}

function parseValueLimitMetadata(value: string): { value: string; metadata?: ArchiveLimitMetadata } {
  const metadataMatch = value.match(/\[dv:([^>\]]*)>>([^|\]]*)\|max:([^\]]*)\]$/);
  if (!metadataMatch) return { value };

  return {
    value: value.slice(0, metadataMatch.index),
    metadata: {
      dayValueOld: metadataMatch[1],
      dayValueNew: metadataMatch[2],
      maxValue: metadataMatch[3],
    },
  };
}

export function parseArchiveDiff(diffStr: string): ArchiveChange[] {
  if (!diffStr || diffStr.trim() === '') return [];
  const entries = splitArchiveDiffEntries(diffStr).filter((s) => s.length > 0);
  return entries.map((entry) => {
    const eqIndex = entry.indexOf('=');
    if (eqIndex === -1) {
      return { key: entry, keyParts: [entry], rootKey: entry, oldValue: '', newValue: '', changeType: 'update' as ChangeType };
    }
    const key = decodeUtf8HexEscapes(entry.substring(0, eqIndex));
    const valuePart = entry.substring(eqIndex + 1);

    let oldValue: string, newValue: string;

    // 查找 >>> 分隔符
    const tripleArrowIndex = valuePart.indexOf('>>>');

    if (tripleArrowIndex === -1) {
      // 无分隔符：oldValue 和 newValue 相同
      oldValue = valuePart;
      newValue = valuePart;
    } else {
      // 有 >>> 分隔符，检查是新格式还是旧格式
      const beforeTriple = valuePart.substring(0, tripleArrowIndex);
      const afterTriple = valuePart.substring(tripleArrowIndex + 3);

      const doubleArrowIndex = beforeTriple.indexOf('>>');

      if (doubleArrowIndex !== -1) {
        // 新格式：oldValue>>newValue>>>op_type>>final_value
        oldValue = beforeTriple.substring(0, doubleArrowIndex);
        newValue = beforeTriple.substring(doubleArrowIndex + 2);
        // 忽略 op_type 和 final_value（afterTriple）
      } else {
        // 旧格式：oldValue>>>newValue
        oldValue = beforeTriple;
        newValue = afterTriple;
      }
    }

    const oldParsed = parseValueLimitMetadata(oldValue);
    const newParsed = parseValueLimitMetadata(newValue);
    oldValue = decodeUtf8HexEscapes(oldParsed.value);
    newValue = decodeUtf8HexEscapes(newParsed.value);
    const limitMetadata = newParsed.metadata ?? oldParsed.metadata;

    const keyParts = key.split('-');
    return {
      key,
      keyParts,
      rootKey: keyParts[0],
      oldValue,
      newValue,
      changeType: getChangeType(oldValue, newValue),
      ...(limitMetadata ? { limitMetadata } : {}),
    };
  });
}
