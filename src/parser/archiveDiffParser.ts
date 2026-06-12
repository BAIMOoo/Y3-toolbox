import type { ArchiveChange, ChangeType } from '../types';

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

export function parseArchiveDiff(diffStr: string): ArchiveChange[] {
  if (!diffStr || diffStr.trim() === '') return [];
  const entries = diffStr.split('|').filter((s) => s.length > 0);
  return entries.map((entry) => {
    const eqIndex = entry.indexOf('=');
    if (eqIndex === -1) {
      return { key: entry, keyParts: [entry], rootKey: entry, oldValue: '', newValue: '', changeType: 'update' as ChangeType };
    }
    const key = entry.substring(0, eqIndex);
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

    const keyParts = key.split('-');
    return { key, keyParts, rootKey: keyParts[0], oldValue, newValue, changeType: getChangeType(oldValue, newValue) };
  });
}
