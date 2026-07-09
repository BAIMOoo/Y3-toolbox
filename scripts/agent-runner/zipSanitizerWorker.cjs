const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { TextDecoder } = require('node:util');
const yauzl = require('yauzl');
const yazl = require('yazl');

const MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES = 100 * 1024 * 1024;
const LARGE_ENTRY_STREAM_THRESHOLD_BYTES = 8 * 1024 * 1024;
const LARGE_ENTRY_TEXT_SCAN_TAIL_CHARS = 8192;
const LARGE_ENTRY_TEXT_SCAN_EMIT_CHARS = 16 * 1024 * 1024;
const LARGE_ENTRY_TEXT_EMIT_CHARS = 1024 * 1024;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:(?:\\\\|\\)[^\s;,)\"]+/g;
const UNC_PATH_PATTERN = /\\\\(?!x[0-9a-fA-F]{2})(?:[^\s;,)\"\\/]+[\\/])+[^\s;,)\"]+/g;
const POSIX_MOUNT_PATH_PATTERN = /\/mnt\/[a-z]\/[^\s;,)\"]+/g;
const SENSITIVE_ENV_ASSIGNMENT_PATTERN = /\b[A-Z0-9_]*(?:AGENT|Y3|VITE|TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*=[^\s;,)\"]+/gi;
const DANGEROUS_EXECUTABLE_TEXT_PATTERN = /(?:\.exe|\.bat|\.cmd|\.ps1|\.sh|\.py)(?:\s|$)/i;
const BINARY_CONTROL_TEXT_PATTERN = /[\x00-\x08\x0b\x0e-\x1f]/;
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

class WithholdPublicZipArtifact extends Error {}

(async () => {
  try {
    const { inputPath, tempPath } = workerData || {};
    if (typeof inputPath !== 'string' || typeof tempPath !== 'string') throw new Error('Zip sanitizer worker requires inputPath and tempPath');
    const wrote = await sanitizeZipArtifact(inputPath, tempPath);
    parentPort.postMessage({ ok: true, wrote });
  } catch (error) {
    if (error instanceof WithholdPublicZipArtifact) parentPort.postMessage({ ok: true, wrote: false });
    else parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    parentPort.close();
  }
})();

async function sanitizeZipArtifact(inputPath, tempPath) {
  const scan = await scanZipArtifact(inputPath);
  if (!scan || scan.keptEntries === 0) return false;
  if (scan.copyOriginal) {
    await copyValidatedZipArtifact(inputPath, tempPath);
    return true;
  }
  return await repackZipArtifact(inputPath, tempPath);
}

async function scanZipArtifact(inputPath) {
  const zipfile = await openZip(inputPath).catch(() => null);
  if (!zipfile) return null;

  let fileHandle;
  let keptEntries = 0;
  let copyOriginal = !hasZipComment(zipfile.comment);
  let centralDirectoryOffset = null;
  const localRanges = [];

  try {
    fileHandle = await fs.promises.open(inputPath, 'r');
    centralDirectoryOffset = await readCentralDirectoryOffset(fileHandle).catch(() => null);
    if (centralDirectoryOffset == null) copyOriginal = false;
    for (;;) {
      const entry = await readNextEntry(zipfile);
      if (!entry) break;
      const entryName = decodeEntryName(entry);
      if (isEncryptedZipEntry(entry)) throw new WithholdPublicZipArtifact('Encrypted zip entries are not public-safe');
      if (!hasSimpleCopySafeEntryMetadata(entry, entryName)) copyOriginal = false;
      if (!isUserResultZipEntry(entryName)) {
        copyOriginal = false;
        continue;
      }
      keptEntries += 1;
      if (copyOriginal) {
        const localRange = await getCopySafeLocalRange(fileHandle, entry, entryName);
        if (localRange) localRanges.push(localRange);
        else copyOriginal = false;
      }
      const unchanged = entry.uncompressedSize > LARGE_ENTRY_STREAM_THRESHOLD_BYTES
        ? await scanLargeEntryContentUnchanged(zipfile, entry)
        : scanSmallEntryContentUnchanged(await readEntryContent(zipfile, entry));
      if (!unchanged) copyOriginal = false;
    }

    if (copyOriginal && !hasContiguousLocalRanges(localRanges, centralDirectoryOffset)) copyOriginal = false;

    return { keptEntries, copyOriginal: keptEntries > 0 && copyOriginal };
  } catch (error) {
    if (error instanceof WithholdPublicZipArtifact) return null;
    throw error;
  } finally {
    try {
      await fileHandle?.close();
    } finally {
      zipfile.close();
    }
  }
}

async function copyValidatedZipArtifact(inputPath, tempPath) {
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  await fs.promises.copyFile(inputPath, tempPath, fs.constants.COPYFILE_EXCL);
}

async function repackZipArtifact(inputPath, tempPath) {
  const zipfile = await openZip(inputPath).catch(() => null);
  if (!zipfile) return false;

  const output = new yazl.ZipFile();
  const outputDone = writeOutputZip(output, tempPath);
  let keptEntries = 0;

  try {
    for (;;) {
      const entry = await readNextEntry(zipfile);
      if (!entry) break;
      const entryName = decodeEntryName(entry);
      if (!isUserResultZipEntry(entryName)) continue;
      if (entry.uncompressedSize > LARGE_ENTRY_STREAM_THRESHOLD_BYTES) {
        addLargeSanitizedEntry(output, zipfile, entry, entryName);
        keptEntries += 1;
        continue;
      }
      const content = await readEntryContent(zipfile, entry);
      const sanitized = sanitizePublicZipEntryContent(content);
      output.addBuffer(sanitized, entryName, { compressionLevel: 1 });
      keptEntries += 1;
    }

    if (keptEntries === 0) {
      output.end();
      await outputDone.catch(() => undefined);
      return false;
    }

    output.end();
    await outputDone;
    return true;
  } catch (error) {
    output.end();
    await outputDone.catch(() => undefined);
    if (error instanceof WithholdPublicZipArtifact) return false;
    throw error;
  } finally {
    zipfile.close();
  }
}

function openZip(inputPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(inputPath, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: false,
      decodeStrings: false,
    }, (error, zipfile) => {
      if (error || !zipfile) reject(error || new Error('Unable to open zip artifact'));
      else resolve(zipfile);
    });
  });
}

function readNextEntry(zipfile) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zipfile.off('entry', onEntry);
      zipfile.off('end', onEnd);
      zipfile.off('error', onError);
    };
    const onEntry = (entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error) => {
      cleanup();
      reject(new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error)));
    };
    zipfile.once('entry', onEntry);
    zipfile.once('end', onEnd);
    zipfile.once('error', onError);
    zipfile.readEntry();
  });
}

function decodeEntryName(entry) {
  const rawName = Buffer.isBuffer(entry.fileName) ? entry.fileName : Buffer.from(String(entry.fileName), 'utf8');
  return decodeZipName(rawName, entry.generalPurposeBitFlag);
}

function decodeZipName(rawName, flags) {
  const hasNonAsciiBytes = rawName.some((byte) => byte > 0x7f);
  if (hasNonAsciiBytes && (flags & 0x0800) === 0) {
    throw new WithholdPublicZipArtifact('Zip entry filename encoding is uncertain');
  }
  try {
    return TEXT_DECODER.decode(rawName);
  } catch {
    throw new WithholdPublicZipArtifact('Zip entry filename is not valid UTF-8');
  }
}

async function getCopySafeLocalRange(fileHandle, entry, entryName) {
  const headerOffset = Number(entry.relativeOffsetOfLocalHeader);
  if (!Number.isSafeInteger(headerOffset) || headerOffset < 0) return false;

  const header = await readFileHandleSlice(fileHandle, headerOffset, 30).catch(() => null);
  if (!header || header.length !== 30 || header.readUInt32LE(0) !== 0x04034b50) return null;

  const flags = header.readUInt16LE(6);
  const method = header.readUInt16LE(8);
  const crc32 = header.readUInt32LE(14);
  const compressedSize = header.readUInt32LE(18);
  const uncompressedSize = header.readUInt32LE(22);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  if (extraLength !== 0) return null;
  if (flags !== entry.generalPurposeBitFlag || method !== entry.compressionMethod) return null;
  if (crc32 !== entry.crc32 || compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize) return null;
  if ((flags & 0x0008) !== 0 || ![0, 8].includes(method)) return null;

  const rawLocalName = await readFileHandleSlice(fileHandle, headerOffset + 30, nameLength).catch(() => null);
  if (!rawLocalName || rawLocalName.length !== nameLength) return null;

  let localName;
  try {
    localName = decodeZipName(rawLocalName, flags);
  } catch {
    return null;
  }
  if (localName !== entryName || !isUserResultZipEntry(localName)) return null;

  const dataStart = headerOffset + 30 + nameLength;
  const dataEnd = dataStart + compressedSize;
  if (!Number.isSafeInteger(dataEnd) || dataEnd < dataStart) return null;
  return { start: headerOffset, end: dataEnd };
}

async function readCentralDirectoryOffset(fileHandle) {
  const stat = await fileHandle.stat();
  const fileSize = Number(stat.size);
  if (!Number.isSafeInteger(fileSize) || fileSize < 22) return null;

  const maxEocdSearch = Math.min(fileSize, 22 + 0xffff);
  const searchStart = fileSize - maxEocdSearch;
  const tail = await readFileHandleSlice(fileHandle, searchStart, maxEocdSearch);
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) !== 0x06054b50) continue;
    const commentLength = tail.readUInt16LE(index + 20);
    if (index + 22 + commentLength !== tail.length) continue;

    const diskNumber = tail.readUInt16LE(index + 4);
    const centralDirectoryDisk = tail.readUInt16LE(index + 6);
    const entriesOnDisk = tail.readUInt16LE(index + 8);
    const totalEntries = tail.readUInt16LE(index + 10);
    const centralDirectorySize = tail.readUInt32LE(index + 12);
    const centralDirectoryOffset = tail.readUInt32LE(index + 16);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) return null;
    if (centralDirectoryOffset === 0xffffffff || centralDirectorySize === 0xffffffff || totalEntries === 0xffff) return null;
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
    if (!Number.isSafeInteger(centralDirectoryEnd) || centralDirectoryEnd !== searchStart + index) return null;
    if (!await hasExactCentralDirectoryRecords(fileHandle, centralDirectoryOffset, totalEntries, searchStart + index)) return null;
    return centralDirectoryOffset;
  }
  return null;
}

async function hasExactCentralDirectoryRecords(fileHandle, centralDirectoryOffset, totalEntries, eocdOffset) {
  if (!Number.isSafeInteger(centralDirectoryOffset)
    || !Number.isSafeInteger(totalEntries)
    || !Number.isSafeInteger(eocdOffset)
    || centralDirectoryOffset < 0
    || totalEntries < 0
    || eocdOffset < centralDirectoryOffset) {
    return false;
  }

  let offset = centralDirectoryOffset;
  for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
    if (offset + 46 > eocdOffset) return false;
    const header = await readFileHandleSlice(fileHandle, offset, 46).catch(() => null);
    if (!header || header.length !== 46 || header.readUInt32LE(0) !== 0x02014b50) return false;

    const nameLength = header.readUInt16LE(28);
    const extraLength = header.readUInt16LE(30);
    const commentLength = header.readUInt16LE(32);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    const nextOffset = offset + recordLength;
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > eocdOffset) return false;
    offset = nextOffset;
  }

  return offset === eocdOffset;
}

function hasContiguousLocalRanges(ranges, centralDirectoryOffset) {
  if (!Number.isSafeInteger(centralDirectoryOffset) || centralDirectoryOffset < 0) return false;
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  let expectedStart = 0;
  for (const range of sorted) {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start !== expectedStart || range.end < range.start) {
      return false;
    }
    expectedStart = range.end;
  }
  return expectedStart === centralDirectoryOffset;
}

async function readFileHandleSlice(fileHandle, offset, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fileHandle.read(buffer, 0, length, offset);
  return buffer.subarray(0, bytesRead);
}

function hasZipComment(comment) {
  if (comment == null) return false;
  if (Buffer.isBuffer(comment)) return comment.length > 0;
  if (typeof comment === 'string') return comment.length > 0;
  if (typeof comment.length === 'number') return comment.length > 0;
  return String(comment).length > 0;
}

function hasSimpleCopySafeEntryMetadata(entry, entryName) {
  if (hasZipComment(entry.comment)
    || hasZipComment(entry.fileComment)
    || hasZipComment(entry.fileCommentRaw)
    || hasZipComment(entry.extraFieldRaw)
    || Number(entry.extraFieldLength || 0) > 0) {
    return false;
  }
  if (!isAsciiText(entryName) && (entry.generalPurposeBitFlag & 0x0800) === 0) return false;
  return true;
}

function isAsciiText(value) {
  return /^[\x00-\x7f]*$/.test(value);
}

function isEncryptedZipEntry(entry) {
  if (entry && typeof entry.isEncrypted === 'function' && entry.isEncrypted()) return true;
  return Boolean(entry && (entry.generalPurposeBitFlag & 0x0001));
}

function scanSmallEntryContentUnchanged(content) {
  return sanitizePublicZipEntryContent(content) === content;
}

function scanLargeEntryContentUnchanged(zipfile, entry) {
  if (entry.isEncrypted && entry.isEncrypted()) throw new WithholdPublicZipArtifact('Encrypted zip entries are not public-safe');
  if (entry.uncompressedSize > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES) throw new WithholdPublicZipArtifact('Zip entry exceeds public scan limit');
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error || 'Unable to read zip entry')));
        return;
      }
      const scanner = new PublicTextScanTransform(entry.uncompressedSize);
      let settled = false;
      const failClosed = (err) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        scanner.destroy();
        reject(err instanceof WithholdPublicZipArtifact ? err : new WithholdPublicZipArtifact(err instanceof Error ? err.message : String(err)));
      };
      stream.once('error', failClosed);
      scanner.once('error', failClosed);
      scanner.once('finish', () => {
        if (settled) return;
        settled = true;
        resolve(!scanner.changed);
      });
      stream.pipe(scanner);
    });
  });
}

function addLargeSanitizedEntry(output, zipfile, entry, entryName) {
  if (entry.isEncrypted && entry.isEncrypted()) throw new WithholdPublicZipArtifact('Encrypted zip entries are not public-safe');
  if (entry.uncompressedSize > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES) throw new WithholdPublicZipArtifact('Zip entry exceeds public scan limit');
  output.addReadStreamLazy(entryName, { compressionLevel: 1 }, (callback) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        callback(new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error || 'Unable to read zip entry')));
        return;
      }
      const sanitized = new PublicTextSanitizeTransform(entry.uncompressedSize);
      let failed = false;
      const failClosed = (err) => {
        if (failed) return;
        failed = true;
        const publicError = err instanceof WithholdPublicZipArtifact
          ? err
          : new WithholdPublicZipArtifact(err instanceof Error ? err.message : String(err));
        stream.destroy(publicError);
        sanitized.destroy(publicError);
        output.emit('error', publicError);
      };
      stream.once('error', failClosed);
      sanitized.once('error', failClosed);
      callback(null, stream.pipe(sanitized));
    });
  });
}

class PublicTextScanTransform extends Transform {
  constructor(expectedSize) {
    super();
    this.expectedSize = expectedSize;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.pendingTextParts = [];
    this.pendingTextLength = 0;
    this.total = 0;
    this.changed = false;
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.total += chunk.length;
      if (this.total > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES || this.total > this.expectedSize) {
        throw new WithholdPublicZipArtifact('Zip entry exceeds public scan limit');
      }
      const decoded = this.decoder.decode(chunk, { stream: true });
      if (hasBinaryControlText(decoded)) {
        throw new WithholdPublicZipArtifact('Zip entry is not unambiguous UTF-8 text');
      }
      this.pendingTextParts.push(decoded);
      this.pendingTextLength += decoded.length;
      if (this.pendingTextLength <= LARGE_ENTRY_TEXT_SCAN_TAIL_CHARS + LARGE_ENTRY_TEXT_SCAN_EMIT_CHARS) {
        callback();
        return;
      }
      const text = this.pendingTextParts.join('');
      const safeToScan = text.slice(0, -LARGE_ENTRY_TEXT_SCAN_TAIL_CHARS);
      const tail = text.slice(-LARGE_ENTRY_TEXT_SCAN_TAIL_CHARS);
      this.pendingTextParts = [tail];
      this.pendingTextLength = tail.length;
      if (sanitizePublicTextSegment(safeToScan) !== safeToScan) this.changed = true;
      callback();
    } catch (error) {
      callback(error instanceof WithholdPublicZipArtifact ? error : new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error)));
    }
  }

  _flush(callback) {
    try {
      const decoded = this.decoder.decode();
      if (decoded.length > 0) {
        this.pendingTextParts.push(decoded);
        this.pendingTextLength += decoded.length;
      }
      const text = this.pendingTextParts.join('');
      if (this.total !== this.expectedSize) throw new WithholdPublicZipArtifact('Zip entry size mismatch');
      if (text.length > 0 && sanitizePublicTextSegment(text) !== text) this.changed = true;
      callback();
    } catch (error) {
      callback(error instanceof WithholdPublicZipArtifact ? error : new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error)));
    }
  }
}

class PublicTextSanitizeTransform extends Transform {
  constructor(expectedSize) {
    super();
    this.expectedSize = expectedSize;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.pendingTextParts = [];
    this.pendingTextLength = 0;
    this.total = 0;
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.total += chunk.length;
      if (this.total > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES || this.total > this.expectedSize) {
        throw new WithholdPublicZipArtifact('Zip entry exceeds public scan limit');
      }
      const decoded = this.decoder.decode(chunk, { stream: true });
      if (hasBinaryControlText(decoded)) {
        throw new WithholdPublicZipArtifact('Zip entry is not unambiguous UTF-8 text');
      }
      this.pendingTextParts.push(decoded);
      this.pendingTextLength += decoded.length;
      if (this.pendingTextLength <= LARGE_ENTRY_TEXT_SCAN_TAIL_CHARS + LARGE_ENTRY_TEXT_EMIT_CHARS) {
        callback();
        return;
      }
      const text = this.pendingTextParts.join('');
      const safeToEmit = text.slice(0, -LARGE_ENTRY_TEXT_SCAN_TAIL_CHARS);
      const tail = text.slice(-LARGE_ENTRY_TEXT_SCAN_TAIL_CHARS);
      this.pendingTextParts = [tail];
      this.pendingTextLength = tail.length;
      this.push(Buffer.from(sanitizePublicTextSegment(safeToEmit), 'utf8'));
      callback();
    } catch (error) {
      callback(error instanceof WithholdPublicZipArtifact ? error : new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error)));
    }
  }

  _flush(callback) {
    try {
      const decoded = this.decoder.decode();
      if (decoded.length > 0) {
        this.pendingTextParts.push(decoded);
        this.pendingTextLength += decoded.length;
      }
      const text = this.pendingTextParts.join('');
      if (this.total !== this.expectedSize) throw new WithholdPublicZipArtifact('Zip entry size mismatch');
      if (text.length > 0) this.push(Buffer.from(sanitizePublicTextSegment(text), 'utf8'));
      callback();
    } catch (error) {
      callback(error instanceof WithholdPublicZipArtifact ? error : new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error)));
    }
  }
}

function sanitizePublicTextSegment(text) {
  const redacted = redactExecutableNames(redactPublicTextContent(text));
  if (hasUnsafePublicText(redacted)) throw new WithholdPublicZipArtifact('Zip entry contains unsafe public text');
  return redacted;
}

function isPublicTextSegmentUnchanged(text) {
  if (!mayContainPublicTextToRedact(text)
    && !mayContainUnsafePublicText(text)
    && !mayContainExecutableName(text)) {
    return true;
  }
  return sanitizePublicTextSegment(text) === text;
}

function readEntryContent(zipfile, entry) {
  if (entry.isEncrypted && entry.isEncrypted()) throw new WithholdPublicZipArtifact('Encrypted zip entries are not public-safe');
  if (entry.uncompressedSize > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES) throw new WithholdPublicZipArtifact('Zip entry exceeds public scan limit');
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new WithholdPublicZipArtifact(error instanceof Error ? error.message : String(error || 'Unable to read zip entry')));
        return;
      }
      const chunks = [];
      let total = 0;
      let settled = false;
      const failClosed = (err) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(err instanceof WithholdPublicZipArtifact ? err : new WithholdPublicZipArtifact(err instanceof Error ? err.message : String(err)));
      };
      stream.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_PUBLIC_ZIP_ENTRY_SCAN_BYTES || total > entry.uncompressedSize) {
          failClosed(new WithholdPublicZipArtifact('Zip entry exceeds public scan limit'));
          return;
        }
        chunks.push(chunk);
      });
      stream.once('error', failClosed);
      stream.once('end', () => {
        if (settled) return;
        settled = true;
        if (total !== entry.uncompressedSize) {
          reject(new WithholdPublicZipArtifact('Zip entry size mismatch'));
          return;
        }
        resolve(Buffer.concat(chunks, total));
      });
    });
  });
}

function writeOutputZip(zipfile, tempPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    const writer = fs.createWriteStream(tempPath, { flags: 'wx' });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      writer.destroy();
      zipfile.outputStream.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    zipfile.once('error', fail);
    zipfile.outputStream.once('error', fail);
    writer.once('error', fail);
    writer.once('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zipfile.outputStream.pipe(writer);
  });
}

function sanitizePublicZipEntryContent(content) {
  let text;
  try {
    text = TEXT_DECODER.decode(content);
  } catch {
    throw new WithholdPublicZipArtifact('Zip entry is not valid UTF-8 text');
  }
  if (hasBinaryControlText(text)) throw new WithholdPublicZipArtifact('Zip entry is not unambiguous UTF-8 text');
  const redacted = redactExecutableNames(redactPublicTextContent(text));
  if (hasUnsafePublicText(redacted)) throw new WithholdPublicZipArtifact('Zip entry contains unsafe public text');
  return redacted === text ? content : Buffer.from(redacted, 'utf8');
}

function hasBinaryControlText(text) {
  return BINARY_CONTROL_TEXT_PATTERN.test(text);
}

function redactExecutableNames(value) {
  if (!mayContainExecutableName(value)) return value;
  return value.replace(/[^\s\\/"']+\.(?:exe|bat|cmd|ps1|sh|py)\b/gi, '[executable]');
}

function isUserResultZipEntry(name) {
  const normalized = name.replace(/\\/g, '/');
  if (hasUnsafeArchiveEntryName(normalized)) return false;
  const extension = path.extname(normalized).toLowerCase();
  return ['.csv', '.json', '.txt'].includes(extension);
}

function redactPublicTextContent(value) {
  const text = String(value);
  if (!mayContainPublicTextToRedact(text)) return text;
  return text
    .replace(resetPattern(WINDOWS_PATH_PATTERN), '[local-path]')
    .replace(resetPattern(UNC_PATH_PATTERN), '[local-path]')
    .replace(resetPattern(POSIX_MOUNT_PATH_PATTERN), '[local-path]')
    .replace(resetPattern(SENSITIVE_ENV_ASSIGNMENT_PATTERN), '[env]');
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
  if (!mayContainUnsafePublicText(value)) return false;
  return (mayContainWindowsPath(value) && testPattern(WINDOWS_PATH_PATTERN, value))
    || (mayContainUncPath(value) && testPattern(UNC_PATH_PATTERN, value))
    || (mayContainPosixMountPath(value) && testPattern(POSIX_MOUNT_PATH_PATTERN, value))
    || /(?:^|[\s/])\.\.(?:[/]|$)/.test(value)
    || (mayContainSensitiveEnvAssignment(value) && hasSensitivePublicText(value))
    || (mayContainExecutableName(value) && DANGEROUS_EXECUTABLE_TEXT_PATTERN.test(value));
}

function mayContainPublicTextToRedact(value) {
  return mayContainWindowsPath(value)
    || mayContainUncPath(value)
    || mayContainPosixMountPath(value)
    || mayContainSensitiveEnvAssignment(value);
}

function mayContainUnsafePublicText(value) {
  return mayContainWindowsPath(value)
    || mayContainUncPath(value)
    || mayContainPosixMountPath(value)
    || value.includes('..')
    || mayContainSensitiveEnvAssignment(value)
    || mayContainExecutableName(value);
}

function mayContainWindowsPath(value) {
  return /[A-Za-z]:\\/.test(value);
}

function mayContainUncPath(value) {
  return value.includes('\\\\');
}

function mayContainPosixMountPath(value) {
  return /\/mnt\/[a-z]\//.test(value);
}

function mayContainSensitiveEnvAssignment(value) {
  return value.includes('=') && /(?:AGENT|Y3|VITE|TOKEN|SECRET|PASSWORD|API_KEY)/i.test(value);
}

function mayContainExecutableName(value) {
  const lowerValue = value.toLowerCase();
  return lowerValue.includes('.exe')
    || lowerValue.includes('.bat')
    || lowerValue.includes('.cmd')
    || lowerValue.includes('.ps1')
    || lowerValue.includes('.sh')
    || lowerValue.includes('.py');
}


function testPattern(pattern, value) {
  pattern.lastIndex = 0;
  const result = pattern.test(value);
  pattern.lastIndex = 0;
  return result;
}

function resetPattern(pattern) {
  pattern.lastIndex = 0;
  return pattern;
}

function hasSensitivePublicText(value) {
  if (!/[=]/.test(value) || !/(?:AGENT|Y3|VITE|TOKEN|SECRET|PASSWORD|API_KEY)/i.test(value)) return false;
  return testPattern(SENSITIVE_ENV_ASSIGNMENT_PATTERN, value);
}
