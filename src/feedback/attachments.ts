import type { FeedbackAttachmentKind, FeedbackUploadRequest } from './types';

export const FEEDBACK_MAX_ATTACHMENTS = 5;
export const FEEDBACK_MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const FEEDBACK_MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const FEEDBACK_ATTACHMENT_ACCEPT = '.log,.trace,.txt,.json,image/png,image/jpeg,image/webp';

const SCREENSHOT_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'application/json']);
const SCREENSHOT_EXTENSION_MEDIA_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
]);

export interface PreparedFeedbackAttachment extends FeedbackUploadRequest {
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  uploadId?: string;
}

export class FeedbackAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedbackAttachmentValidationError';
  }
}

export async function prepareFeedbackAttachments(
  files: readonly File[],
  existing: readonly PreparedFeedbackAttachment[],
  createId: () => string,
): Promise<PreparedFeedbackAttachment[]> {
  if (existing.length + files.length > FEEDBACK_MAX_ATTACHMENTS) {
    throw new FeedbackAttachmentValidationError(`一次最多添加 ${FEEDBACK_MAX_ATTACHMENTS} 个附件。`);
  }

  const prepared: PreparedFeedbackAttachment[] = [];
  const fingerprints = new Set(existing.map(attachmentFingerprint));
  let totalBytes = existing.reduce((sum, attachment) => sum + attachment.decodedByteSize, 0);
  for (const file of files) {
    const displayName = sanitizeDisplayName(file.name);
    const { kind, mediaType } = classifyFile(file, displayName);
    if (file.size === 0) throw new FeedbackAttachmentValidationError('附件不能为空。');
    const fingerprint = `${kind}\u0000${displayName}\u0000${mediaType}\u0000${file.size}`;
    if (fingerprints.has(fingerprint)) throw new FeedbackAttachmentValidationError(`附件“${displayName}”已添加。`);
    fingerprints.add(fingerprint);

    const byteLimit = kind === 'screenshot' ? FEEDBACK_MAX_SCREENSHOT_BYTES : FEEDBACK_MAX_TEXT_ATTACHMENT_BYTES;
    if (file.size > byteLimit) {
      throw new FeedbackAttachmentValidationError(kind === 'screenshot'
        ? '单张截图不能超过 8 MiB。'
        : '单个日志或 Trace 文件不能超过 2 MiB。');
    }
    totalBytes += file.size;
    if (totalBytes > FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new FeedbackAttachmentValidationError('每次反馈的附件总大小不能超过 16 MiB。');
    }

    prepared.push({
      schemaVersion: 1,
      clientUploadId: createId(),
      kind,
      displayName,
      mediaType,
      decodedByteSize: file.size,
      contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      status: 'pending',
    });
  }
  return prepared;
}

export function totalFeedbackAttachmentBytes(attachments: readonly PreparedFeedbackAttachment[]): number {
  return attachments.reduce((sum, attachment) => sum + attachment.decodedByteSize, 0);
}

function attachmentFingerprint(attachment: PreparedFeedbackAttachment): string {
  return [attachment.kind, attachment.displayName, attachment.mediaType, attachment.decodedByteSize].join('\u0000');
}

function sanitizeDisplayName(name: string): string {
  if (/[/\\]/.test(name) || /^[A-Za-z]:/.test(name) || /^[a-z][a-z0-9+.-]*:/i.test(name)) {
    throw new FeedbackAttachmentValidationError('附件名称不能包含本地路径。');
  }
  const sanitized = Array.from(name)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new FeedbackAttachmentValidationError('附件名称无效。');
  }
  return sanitized;
}

function classifyFile(file: File, displayName: string): { kind: FeedbackAttachmentKind; mediaType: string } {
  const declaredType = file.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  const extension = displayName.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  const screenshotMediaType = SCREENSHOT_EXTENSION_MEDIA_TYPES.get(extension);
  if (SCREENSHOT_MEDIA_TYPES.has(declaredType) || screenshotMediaType) {
    if (!screenshotMediaType || (declaredType && declaredType !== screenshotMediaType)) {
      throw new FeedbackAttachmentValidationError('截图文件扩展名必须与 PNG、JPEG 或 WebP 类型一致。');
    }
    return { kind: 'screenshot', mediaType: screenshotMediaType };
  }

  const textExtension = ['log', 'trace', 'txt', 'json'].includes(extension);
  if ((TEXT_MEDIA_TYPES.has(declaredType) || (!declaredType && textExtension)) && textExtension) {
    return {
      kind: extension === 'trace' || /(?:^|[._-])trace(?:[._-]|$)/i.test(displayName) ? 'trace' : 'log',
      mediaType: extension === 'json' ? 'application/json' : 'text/plain',
    };
  }
  throw new FeedbackAttachmentValidationError('仅支持日志、Trace 文本以及 PNG、JPEG、WebP 截图。');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
