import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixturePath(name: string): string {
  return path.join(fixturesDirectory, name);
}

export async function makeTemporaryDirectory(suffix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `zippogryph-${suffix}-`));
}

export interface ZipBuilderEntry {
  name: string;
  data: Buffer;
  method?: 0 | 8;
  utf8?: boolean;
  externalFileAttributes?: number;
  versionMadeBy?: number;
}

export const UNIX_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;
export const UNIX_DIRECTORY_ATTRIBUTES = (0o040755 << 16) >>> 0;
export const UNIX_SYMLINK_ATTRIBUTES = (0o120777 << 16) >>> 0;
export const UNIX_VERSION_MADE_BY = 0x0314;

export async function writeZipArchive(destinationPath: string, files: ZipBuilderEntry[]): Promise<void> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const uncompressed = file.data;
    const method = file.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(uncompressed) : uncompressed;
    const checksum = crc32(uncompressed) >>> 0;
    const flags = file.utf8 ? 0x0800 : 0;
    const nameBuffer = Buffer.from(file.name, file.utf8 ? 'utf8' : 'latin1');
    const versionMadeBy = file.versionMadeBy ?? UNIX_VERSION_MADE_BY;
    const externalFileAttributes = file.externalFileAttributes ?? UNIX_FILE_ATTRIBUTES;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);

    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(versionMadeBy, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(externalFileAttributes, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(files.length, 8);
  endOfCentralDirectory.writeUInt16LE(files.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);

  await writeFile(destinationPath, Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]));
}
