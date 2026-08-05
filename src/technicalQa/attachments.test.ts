import { describe, expect, it, vi } from 'vitest';
import {
  prepareQaAttachments,
  QA_MAX_TOTAL_ATTACHMENT_BYTES,
  QA_MAX_SCREENSHOT_BYTES,
  QA_MAX_TEXT_ATTACHMENT_BYTES,
} from './attachments';

describe('Technical QA diagnostic attachment preparation', () => {
  it('reads only selected browser File bytes and classifies log, Trace, and screenshot media', async () => {
    const files = [
      file('game.log', 'text/plain', 'line one'),
      file('runtime.trace', 'text/plain', 'trace line'),
      file('capture.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    ];

    const prepared = await prepareQaAttachments(files, [], ids());

    expect(prepared.map(({ kind, displayName, mediaType }) => ({ kind, displayName, mediaType }))).toEqual([
      { kind: 'log', displayName: 'game.log', mediaType: 'text/plain' },
      { kind: 'trace', displayName: 'runtime.trace', mediaType: 'text/plain' },
      { kind: 'screenshot', displayName: 'capture.png', mediaType: 'image/png' },
    ]);
    expect(prepared[0]?.contentBase64).toBe(btoa('line one'));
    expect(JSON.stringify(prepared)).not.toMatch(/path|webkitRelativePath/i);
  });

  it.each([
    [file('C:\\private\\game.log', 'text/plain', 'log'), '本地路径'],
    [file('file:game.log', 'text/plain', 'log'), '本地路径'],
    [file('  ..  ', 'text/plain', 'log'), '名称无效'],
    [file('empty.log', 'text/plain', ''), '不能为空'],
    [file('payload.exe', 'application/octet-stream', 'binary'), '仅支持'],
    [file('huge.log', 'text/plain', new Uint8Array(QA_MAX_TEXT_ATTACHMENT_BYTES + 1)), '2 MiB'],
    [file('huge.png', 'image/png', new Uint8Array(QA_MAX_SCREENSHOT_BYTES + 1)), '8 MiB'],
  ])('rejects unsafe or oversized input without preparing a request', async (candidate, message) => {
    await expect(prepareQaAttachments([candidate], [], ids())).rejects.toThrow(message);
  });

  it('normalizes safe display whitespace without corrupting Unicode names', async () => {
    const [prepared] = await prepareQaAttachments([file('诊断  日志.log', 'text/plain', 'log')], [], ids());

    expect(prepared?.displayName).toBe('诊断 日志.log');
  });

  it('enforces the five-file turn limit before reading file contents', async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(1));
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      name: `${index}.log`, type: 'text/plain', size: 1, arrayBuffer,
    })) as unknown as File[];

    await expect(prepareQaAttachments(candidates, [], ids())).rejects.toThrow('最多添加 5 个');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects duplicate selections and aggregate payloads over 16 MiB', async () => {
    const existing = await prepareQaAttachments([file('game.log', 'text/plain', 'log')], [], ids());
    await expect(prepareQaAttachments([file('game.log', 'text/plain', 'log')], existing, ids())).rejects.toThrow(
      '已添加',
    );

    const largeExisting = [
      prepared('first.png', QA_MAX_SCREENSHOT_BYTES),
      prepared('second.png', QA_MAX_SCREENSHOT_BYTES),
    ];
    await expect(prepareQaAttachments([file('extra.log', 'text/plain', 'x')], largeExisting, ids())).rejects.toThrow(
      '16 MiB',
    );
    expect(largeExisting.reduce((sum, item) => sum + item.decodedByteSize, 0)).toBe(QA_MAX_TOTAL_ATTACHMENT_BYTES);
  });
});

function file(name: string, type: string, content: string | Uint8Array): File {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  } as unknown as File;
}

function ids(): () => string {
  let value = 0;
  return () => `upload-client-${++value}`;
}

function prepared(displayName: string, decodedByteSize: number) {
  return {
    schemaVersion: 1 as const,
    clientUploadId: `client-${displayName}`,
    kind: 'screenshot' as const,
    displayName,
    mediaType: 'image/png',
    decodedByteSize,
    contentBase64: '',
    status: 'pending' as const,
  };
}
