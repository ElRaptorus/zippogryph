import { createReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import zlib from 'node:zlib';

import type { ZipEntry, ZipHandle } from './types.js';

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

const ZIP64_EXTRA_FIELD_HEADER = 0x0001;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const MAX_COMMENT_LENGTH = 65535;
const END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;

export const MAX_CENTRAL_DIRECTORY_SIZE = 64 * 1024 * 1024;

async function readExact(fileHandle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await fileHandle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      throw new Error(`Unexpected end of zip file at position ${position + offset}`);
    }
    offset += bytesRead;
  }
  return buffer;
}

function decodeFileName(buffer: Buffer, generalPurposeBitFlag: number): string {
  if ((generalPurposeBitFlag & UTF8_FLAG) !== 0) {
    return buffer.toString('utf8');
  }
  return buffer.toString('latin1');
}

function parseZip64Extra(
  extra: Buffer,
  uncompressedSize: number,
  compressedSize: number,
  relativeOffsetOfLocalHeader: number,
): { uncompressedSize: number; compressedSize: number; relativeOffsetOfLocalHeader: number } {
  let offset = 0;
  let nextUncompressedSize = uncompressedSize;
  let nextCompressedSize = compressedSize;
  let nextRelativeOffset = relativeOffsetOfLocalHeader;

  while (offset + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(offset);
    const dataSize = extra.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + dataSize > extra.length) {
      break;
    }
    if (headerId === ZIP64_EXTRA_FIELD_HEADER) {
      let cursor = offset;
      if (uncompressedSize === 0xffffffff && cursor + 8 <= offset + dataSize) {
        nextUncompressedSize = Number(extra.readBigUInt64LE(cursor));
        cursor += 8;
      }
      if (compressedSize === 0xffffffff && cursor + 8 <= offset + dataSize) {
        nextCompressedSize = Number(extra.readBigUInt64LE(cursor));
        cursor += 8;
      }
      if (relativeOffsetOfLocalHeader === 0xffffffff && cursor + 8 <= offset + dataSize) {
        nextRelativeOffset = Number(extra.readBigUInt64LE(cursor));
      }
    }
    offset += dataSize;
  }

  return {
    uncompressedSize: nextUncompressedSize,
    compressedSize: nextCompressedSize,
    relativeOffsetOfLocalHeader: nextRelativeOffset,
  };
}

function wrapCrc32(stream: Readable, expectedCrc32: number): Readable {
  if (expectedCrc32 === 0) {
    return stream;
  }

  let crc = 0;
  const checker = new Transform({
    transform(chunk, _encoding, callback) {
      crc = zlib.crc32(chunk, crc);
      callback(null, chunk);
    },
    flush(callback) {
      if (crc !== expectedCrc32) {
        callback(new Error(`CRC-32 mismatch: expected ${expectedCrc32}, got ${crc}`));
        return;
      }
      callback();
    },
  });

  stream.on('error', (error) => {
    checker.destroy(error);
  });
  stream.pipe(checker);
  return checker;
}

interface EndOfCentralDirectory {
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
}

function assertSafeNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}: ${String(value)}`);
  }
}

function assertCentralDirectoryWithinCap(endOfCentralDirectory: EndOfCentralDirectory): void {
  assertSafeNonNegativeInteger(endOfCentralDirectory.centralDirectorySize, 'central directory size');
  assertSafeNonNegativeInteger(endOfCentralDirectory.centralDirectoryOffset, 'central directory offset');
  assertSafeNonNegativeInteger(endOfCentralDirectory.entryCount, 'central directory entry count');
  if (endOfCentralDirectory.centralDirectorySize > MAX_CENTRAL_DIRECTORY_SIZE) {
    throw new Error(
      `Central directory is too large (${String(endOfCentralDirectory.centralDirectorySize)} bytes; maximum is ${String(MAX_CENTRAL_DIRECTORY_SIZE)})`,
    );
  }
}

async function findEndOfCentralDirectory(fileHandle: FileHandle, fileSize: number): Promise<EndOfCentralDirectory> {
  if (fileSize < END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE) {
    throw new Error('File is too small to be a zip archive');
  }

  const scanLength = Math.min(fileSize, END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE + MAX_COMMENT_LENGTH);
  const scanStart = fileSize - scanLength;
  const scanBuffer = await readExact(fileHandle, scanStart, scanLength);

  let eocdOffsetInScan = -1;
  for (let index = scanBuffer.length - END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE; index >= 0; index -= 1) {
    if (scanBuffer.readUInt32LE(index) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    const commentLength = scanBuffer.readUInt16LE(index + 20);
    if (index + END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE + commentLength === scanBuffer.length) {
      eocdOffsetInScan = index;
      break;
    }
  }

  if (eocdOffsetInScan < 0) {
    throw new Error('Could not find end of central directory record');
  }

  const diskEntries = scanBuffer.readUInt16LE(eocdOffsetInScan + 8);
  const totalEntries = scanBuffer.readUInt16LE(eocdOffsetInScan + 10);
  const centralDirectorySize = scanBuffer.readUInt32LE(eocdOffsetInScan + 12);
  const centralDirectoryOffset = scanBuffer.readUInt32LE(eocdOffsetInScan + 16);
  const eocdFileOffset = scanStart + eocdOffsetInScan;

  const needsZip64 =
    diskEntries === 0xffff ||
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff;

  if (!needsZip64) {
    return {
      entryCount: totalEntries,
      centralDirectoryOffset,
      centralDirectorySize,
    };
  }

  if (eocdFileOffset < ZIP64_LOCATOR_SIZE) {
    throw new Error('Zip64 end of central directory locator is missing');
  }

  const locator = await readExact(fileHandle, eocdFileOffset - ZIP64_LOCATOR_SIZE, ZIP64_LOCATOR_SIZE);
  if (locator.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE) {
    throw new Error(
      `invalid zip64 end of central directory locator signature: 0x${locator.readUInt32LE(0).toString(16)}`,
    );
  }

  const zip64EocdOffset = Number(locator.readBigUInt64LE(8));
  const zip64Eocd = await readExact(fileHandle, zip64EocdOffset, 56);
  if (zip64Eocd.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error(`invalid zip64 end of central directory signature: 0x${zip64Eocd.readUInt32LE(0).toString(16)}`);
  }

  return {
    entryCount: Number(zip64Eocd.readBigUInt64LE(32)),
    centralDirectorySize: Number(zip64Eocd.readBigUInt64LE(40)),
    centralDirectoryOffset: Number(zip64Eocd.readBigUInt64LE(48)),
  };
}

function parseCentralDirectory(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 46 > buffer.length) {
      throw new Error('Truncated central directory file header');
    }
    const signature = buffer.readUInt32LE(offset);
    if (signature !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error(`invalid central directory file header signature: 0x${signature.toString(16)}`);
    }

    const versionMadeBy = buffer.readUInt16LE(offset + 4);
    const generalPurposeBitFlag = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const lastModFileTime = buffer.readUInt16LE(offset + 12);
    const lastModFileDate = buffer.readUInt16LE(offset + 14);
    const crc32 = buffer.readUInt32LE(offset + 16);
    let compressedSize = buffer.readUInt32LE(offset + 20);
    let uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const externalFileAttributes = buffer.readUInt32LE(offset + 38);
    let relativeOffsetOfLocalHeader = buffer.readUInt32LE(offset + 42);

    const headerEnd = offset + 46;
    const nameEnd = headerEnd + fileNameLength;
    const extraEnd = nameEnd + extraFieldLength;
    const commentEnd = extraEnd + fileCommentLength;
    if (commentEnd > buffer.length) {
      throw new Error('Truncated central directory file header');
    }

    const fileName = decodeFileName(buffer.subarray(headerEnd, nameEnd), generalPurposeBitFlag);
    const extra = buffer.subarray(nameEnd, extraEnd);
    const zip64 = parseZip64Extra(extra, uncompressedSize, compressedSize, relativeOffsetOfLocalHeader);
    uncompressedSize = zip64.uncompressedSize;
    compressedSize = zip64.compressedSize;
    relativeOffsetOfLocalHeader = zip64.relativeOffsetOfLocalHeader;

    entries.push({
      fileName,
      uncompressedSize,
      compressedSize,
      crc32,
      compressionMethod,
      generalPurposeBitFlag,
      lastModFileTime,
      lastModFileDate,
      externalFileAttributes,
      versionMadeBy,
      relativeOffsetOfLocalHeader,
    });

    offset = commentEnd;
  }

  return entries;
}

export class ZipReader {
  readonly entries: ZipEntry[];
  private readonly fileHandle: FileHandle;
  private readonly zipPath: string;
  private closed = false;

  private constructor(zipPath: string, fileHandle: FileHandle, entries: ZipEntry[]) {
    this.zipPath = zipPath;
    this.fileHandle = fileHandle;
    this.entries = entries;
  }

  static async open(zipPath: string): Promise<ZipReader> {
    const fileHandle = await open(zipPath, 'r');
    try {
      const stats = await fileHandle.stat();
      const eocd = await findEndOfCentralDirectory(fileHandle, stats.size);
      assertCentralDirectoryWithinCap(eocd);
      const centralDirectory = await readExact(fileHandle, eocd.centralDirectoryOffset, eocd.centralDirectorySize);
      const entries = parseCentralDirectory(centralDirectory);
      return new ZipReader(zipPath, fileHandle, entries);
    } catch (error) {
      await fileHandle.close();
      throw error;
    }
  }

  getHandle(): ZipHandle {
    return {
      entryCount: this.entries.length,
      isOpen: !this.closed,
      close: () => {
        void this.close();
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.fileHandle.close();
  }

  async openEntryStream(entry: ZipEntry): Promise<Readable> {
    if ((entry.generalPurposeBitFlag & ENCRYPTED_FLAG) !== 0) {
      throw new Error(`Zip entry '${entry.fileName}' is encrypted`);
    }

    const localHeader = await readExact(this.fileHandle, entry.relativeOffsetOfLocalHeader, 30);
    const localSignature = localHeader.readUInt32LE(0);
    if (localSignature !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`invalid local file header signature: 0x${localSignature.toString(16)}`);
    }

    const fileNameLength = localHeader.readUInt16LE(26);
    const extraFieldLength = localHeader.readUInt16LE(28);
    const dataStart = entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength;

    if (entry.compressionMethod === METHOD_STORE) {
      if (entry.compressedSize === 0) {
        return wrapCrc32(Readable.from(Buffer.alloc(0)), entry.crc32);
      }
      const stored = createReadStream(this.zipPath, {
        start: dataStart,
        end: dataStart + entry.compressedSize - 1,
      });
      return wrapCrc32(stored, entry.crc32);
    }

    if (entry.compressionMethod === METHOD_DEFLATE) {
      if (entry.compressedSize === 0) {
        return wrapCrc32(Readable.from(Buffer.alloc(0)), entry.crc32);
      }
      const compressed = createReadStream(this.zipPath, {
        start: dataStart,
        end: dataStart + entry.compressedSize - 1,
      });
      const inflate = zlib.createInflateRaw();
      compressed.on('error', (error) => {
        inflate.destroy(error);
      });
      compressed.pipe(inflate);
      return wrapCrc32(inflate, entry.crc32);
    }

    throw new Error(`Unsupported compression method ${entry.compressionMethod} for entry '${entry.fileName}'`);
  }
}

export async function openZipFile(zipPath: string): Promise<ZipReader> {
  return ZipReader.open(zipPath);
}
