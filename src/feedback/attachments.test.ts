// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_MAX_ATTACHMENTS,
  FEEDBACK_MAX_TEXT_ATTACHMENT_BYTES,
  prepareFeedbackAttachments,
} from './attachments';

describe('Feedback attachment validation', () => {
  it('prepares bug attachments with stable upload ids and base64 content', async () => {
    const [attachment] = await prepareFeedbackAttachments([
      new File(['hello world'], 'editor.log', { type: 'text/plain' }),
    ], [], () => 'client-upload-log');

    expect(attachment).toMatchObject({
      schemaVersion: 1,
      clientUploadId: 'client-upload-log',
      kind: 'log',
      displayName: 'editor.log',
      mediaType: 'text/plain',
      decodedByteSize: 11,
      contentBase64: 'aGVsbG8gd29ybGQ=',
      status: 'pending',
    });
  });

  it('rejects too many, wrong type, oversized, duplicate, and path-like attachments', async () => {
    const files = Array.from({ length: FEEDBACK_MAX_ATTACHMENTS + 1 }, (_, index) => new File(['x'], `a-${index}.log`, { type: 'text/plain' }));
    await expect(prepareFeedbackAttachments(files, [], () => 'id')).rejects.toThrow(/最多/);
    await expect(prepareFeedbackAttachments([new File(['x'], 'run.exe', { type: 'application/octet-stream' })], [], () => 'id')).rejects.toThrow(/仅支持/);
    await expect(prepareFeedbackAttachments([new File(['x'.repeat(FEEDBACK_MAX_TEXT_ATTACHMENT_BYTES + 1)], 'large.log', { type: 'text/plain' })], [], () => 'id')).rejects.toThrow(/2 MiB/);
    const existing = await prepareFeedbackAttachments([new File(['x'], 'same.log', { type: 'text/plain' })], [], () => 'id-1');
    await expect(prepareFeedbackAttachments([new File(['x'], 'same.log', { type: 'text/plain' })], existing, () => 'id-2')).rejects.toThrow(/已添加/);
    await expect(prepareFeedbackAttachments([new File(['x'], 'C:\\temp\\secret.log', { type: 'text/plain' })], [], () => 'id')).rejects.toThrow(/路径/);
  });
  it('requires screenshot MIME declarations and extensions to agree', async () => {
    await expect(prepareFeedbackAttachments([new File(['x'], 'shot.png', { type: 'image/png' })], [], () => 'png-id')).resolves.toMatchObject([
      { kind: 'screenshot', displayName: 'shot.png', mediaType: 'image/png', decodedByteSize: 1 },
    ]);
    await expect(prepareFeedbackAttachments([new File(['x'], 'shot.jpg', { type: 'image/jpeg' })], [], () => 'jpg-id')).resolves.toMatchObject([
      { kind: 'screenshot', displayName: 'shot.jpg', mediaType: 'image/jpeg', decodedByteSize: 1 },
    ]);
    await expect(prepareFeedbackAttachments([new File(['x'], 'shot.webp', { type: 'image/webp' })], [], () => 'webp-id')).resolves.toMatchObject([
      { kind: 'screenshot', displayName: 'shot.webp', mediaType: 'image/webp', decodedByteSize: 1 },
    ]);

    await expect(prepareFeedbackAttachments([new File(['x'], 'shot.jpg', { type: 'image/png' })], [], () => 'id')).rejects.toThrow();
    await expect(prepareFeedbackAttachments([new File(['x'], 'shot.png', { type: 'image/jpeg' })], [], () => 'id')).rejects.toThrow();
    await expect(prepareFeedbackAttachments([new File(['x'], 'shot.txt', { type: 'image/png' })], [], () => 'id')).rejects.toThrow();
  });
});
