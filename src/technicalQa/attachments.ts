import type { QaDiagnosticKind, QaDiagnosticUploadRequest } from './types';

export const QA_MAX_ATTACHMENTS = 5;
export const QA_MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const QA_MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const QA_MAX_TOTAL_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const QA_ATTACHMENT_ACCEPT = '.log,.trace,.txt,.json,image/png,image/jpeg,image/webp';

const SCREENSHOT_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'application/json']);

export interface PreparedQaAttachment extends QaDiagnosticUploadRequest {
  status: 'pending' | 'uploading' | 'error';
}

export interface QaAttachmentSummary {
  kind: QaDiagnosticKind;
  displayName: string;
  decodedByteSize: number;
}

export class QaAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QaAttachmentValidationError';
  }
}

export async function prepareQaAttachments(
  files: readonly File[],
  existing: readonly PreparedQaAttachment[],
  createId: () => string,
): Promise<PreparedQaAttachment[]> {
  if (existing.length + files.length > QA_MAX_ATTACHMENTS) {
    throw new QaAttachmentValidationError(`每次提问最多添加 ${QA_MAX_ATTACHMENTS} 个附件。`);
  }

  const prepared: PreparedQaAttachment[] = [];
  const fingerprints = new Set(existing.map(attachmentFingerprint));
  let totalBytes = existing.reduce((sum, attachment) => sum + attachment.decodedByteSize, 0);
  for (const file of files) {
    const displayName = sanitizeDisplayName(file.name);
    const { kind, mediaType } = classifyFile(file, displayName);
    const fingerprint = `${kind}\u0000${displayName}\u0000${mediaType}\u0000${file.size}`;
    if (fingerprints.has(fingerprint)) {
      throw new QaAttachmentValidationError(`附件“${displayName}”已添加。`);
    }
    fingerprints.add(fingerprint);
    const byteLimit = kind === 'screenshot' ? QA_MAX_SCREENSHOT_BYTES : QA_MAX_TEXT_ATTACHMENT_BYTES;
    if (file.size > byteLimit) {
      throw new QaAttachmentValidationError(
        kind === 'screenshot' ? '单张截图不能超过 8 MiB。' : '单个日志或 Trace 文件不能超过 2 MiB。',
      );
    }
    totalBytes += file.size;
    if (totalBytes > QA_MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new QaAttachmentValidationError('每次提问的附件总大小不能超过 16 MiB。');
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

function attachmentFingerprint(attachment: PreparedQaAttachment): string {
  return [attachment.kind, attachment.displayName, attachment.mediaType, attachment.decodedByteSize].join('\u0000');
}

export function toQaAttachmentSummary(attachment: PreparedQaAttachment): QaAttachmentSummary {
  return {
    kind: attachment.kind,
    displayName: attachment.displayName,
    decodedByteSize: attachment.decodedByteSize,
  };
}

function sanitizeDisplayName(name: string): string {
  if (/[/\\]/.test(name) || /^[A-Za-z]:/.test(name) || name === '.' || name === '..') {
    throw new QaAttachmentValidationError('附件名称不能包含本地路径。');
  }
  const sanitized = Array.from(name, (character) => character.charCodeAt(0))
    .filter((code) => code > 0x1f && code !== 0x7f)
    .map((code) => String.fromCharCode(code))
    .join('')
    .trim();
  if (!sanitized) throw new QaAttachmentValidationError('附件名称无效。');
  return sanitized.slice(0, 160);
}

function classifyFile(file: File, displayName: string): { kind: QaDiagnosticKind; mediaType: string } {
  const declaredType = file.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (SCREENSHOT_MEDIA_TYPES.has(declaredType)) return { kind: 'screenshot', mediaType: declaredType };

  const extension = displayName.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  if (!declaredType && extension === 'png') return { kind: 'screenshot', mediaType: 'image/png' };
  if (!declaredType && (extension === 'jpg' || extension === 'jpeg')) return { kind: 'screenshot', mediaType: 'image/jpeg' };
  if (!declaredType && extension === 'webp') return { kind: 'screenshot', mediaType: 'image/webp' };

  const textExtension = ['log', 'trace', 'txt', 'json'].includes(extension);
  if ((TEXT_MEDIA_TYPES.has(declaredType) || (!declaredType && textExtension)) && textExtension) {
    return {
      kind: extension === 'trace' || /(?:^|[._-])trace(?:[._-]|$)/i.test(displayName) ? 'trace' : 'log',
      mediaType: extension === 'json' ? 'application/json' : 'text/plain',
    };
  }
  throw new QaAttachmentValidationError('仅支持日志、Trace 文本以及 PNG、JPEG、WebP 截图。');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
