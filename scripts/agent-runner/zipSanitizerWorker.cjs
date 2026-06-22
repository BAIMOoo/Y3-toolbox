const { parentPort, workerData } = require('node:worker_threads');
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const path = require('node:path');

const MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES = 100 * 1024 * 1024;
const ZIP_UTF8_FILENAME_FLAG = 0x0800;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:(?:\\\\|\\)[^\s;,)\"]+/g;
const UNC_PATH_PATTERN = /\\\\[^\s;,)\"]+/g;
const POSIX_MOUNT_PATH_PATTERN = /\/mnt\/[a-z]\/[^\s;,)\"]+/g;
const SENSITIVE_ENV_ASSIGNMENT_PATTERN = /\b[A-Z0-9_]*(?:AGENT|Y3|VITE|TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*=[^\s;,)\"]+/gi;
const DANGEROUS_EXECUTABLE_TEXT_PATTERN = /(?:\.exe|\.bat|\.cmd|\.ps1|\.sh|\.py)(?:\s|$)/i;

try {
  const result = sanitize(Buffer.from(workerData));
  parentPort.postMessage({ ok: true, buffer: result });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  parentPort.close();
}

function sanitize(buffer) {
  const entries = zipEntriesFromBuffer(buffer);
  if (!entries?.length) return null;

  const sanitized = [];
  for (const entry of entries) {
    if (!isUserResultZipEntry(entry.name)) continue;
    const content = zipEntryContent(entry.compressed, entry.compressionMethod, entry.uncompressedSize);
    if (!content) continue;
    const body = redactPublicZipEntryContent(content);
    if (body.length === 0 || hasUnsafePublicText(body.toString('utf8'))) continue;
    sanitized.push({ name: entry.name, content: body });
  }
  return sanitized.length ? zipBufferFromEntries(sanitized) : null;
}

function zipEntriesFromBuffer(buffer) {
  const directory = zipCentralDirectoryInfo(buffer);
  if (!directory) return null;
  const entries = [];
  let offset = 0;
  while (offset < directory.centralOffset) {
    if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return null;
    const flags = buffer.readUInt16LE(offset + 6);
    if ((flags & 0x08) !== 0) return null;
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + compressedSize;
    if (nameLength <= 0 || nameEnd > buffer.length || contentEnd > buffer.length || contentEnd > directory.centralOffset) return null;
    entries.push({
      name: buffer.subarray(nameStart, nameEnd).toString('utf8'),
      compressionMethod,
      compressed: buffer.subarray(contentStart, contentEnd),
      uncompressedSize,
    });
    offset = contentEnd;
  }
  return offset === directory.centralOffset ? entries : null;
}

function zipEntryContent(compressed, method, uncompressedSize) {
  try {
    if (uncompressedSize > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES) return null;
    if (method === 0) return compressed;
    if (method === 8) return inflateRawSync(compressed, { maxOutputLength: MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES });
    return null;
  } catch {
    return null;
  }
}

function redactPublicZipEntryContent(content) {
  if (content.includes(0)) return content;
  const text = content.toString('utf8');
  if (text.includes('\uFFFD')) return content;
  const redacted = redactExecutableNames(redactPublicTextContent(text));
  return Buffer.from(redacted, 'utf8');
}

function redactExecutableNames(value) {
  if (!value.includes('.') || !/(?:exe|bat|cmd|ps1|sh|py)/i.test(value)) return value;
  return value.replace(/[^\s\\/"']+\.(?:exe|bat|cmd|ps1|sh|py)\b/gi, '[executable]');
}

function isUserResultZipEntry(name) {
  const normalized = name.replace(/\\/g, '/');
  if (hasUnsafeArchiveEntryName(normalized)) return false;
  const extension = path.extname(normalized).toLowerCase();
  return ['.csv', '.json', '.txt'].includes(extension);
}

function zipBufferFromEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.content);
    const crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(ZIP_UTF8_FILENAME_FLAG, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(ZIP_UTF8_FILENAME_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function zipCentralDirectoryInfo(buffer) {
  for (let offset = Math.max(0, buffer.length - 65_557); offset + 22 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const centralOffset = buffer.readUInt32LE(offset + 16);
    return centralOffset <= offset ? { centralOffset, eocdOffset: offset } : null;
  }
  return null;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function redactPublicTextContent(value) {
  return String(value)
    .replace(WINDOWS_PATH_PATTERN, '[local-path]')
    .replace(UNC_PATH_PATTERN, '[local-path]')
    .replace(POSIX_MOUNT_PATH_PATTERN, '[local-path]')
    .replace(SENSITIVE_ENV_ASSIGNMENT_PATTERN, '[env]');
}

function hasUnsafeArchiveEntryName(name) {
  const normalized = name.replace(/\\/g, '/');
  return !normalized
    || normalized.includes('..')
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.startsWith('//')
    || /(?:^|[/])(?:stdout|stderr|debug|diagnostic|env|command)(?:[/._-]|$)/i.test(normalized)
    || /(?:\.exe|\.bat|\.cmd|\.ps1|\.sh|\.py|\.js)$/i.test(normalized);
}

function hasUnsafePublicText(value) {
  return WINDOWS_PATH_PATTERN.test(value)
    || UNC_PATH_PATTERN.test(value)
    || POSIX_MOUNT_PATH_PATTERN.test(value)
    || /(?:^|[/])\.\.(?:[/]|$)/.test(value)
    || hasSensitivePublicText(value)
    || DANGEROUS_EXECUTABLE_TEXT_PATTERN.test(value);
}

function hasSensitivePublicText(value) {
  if (!/[=]/.test(value) || !/(?:AGENT|Y3|VITE|TOKEN|SECRET|PASSWORD|API_KEY)/i.test(value)) return false;
  SENSITIVE_ENV_ASSIGNMENT_PATTERN.lastIndex = 0;
  return SENSITIVE_ENV_ASSIGNMENT_PATTERN.test(value);
}
