import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { debuglog } from 'node:util';
import { text } from 'node:stream/consumers';

import {
  createContainedSymlink,
  ensureContainedDirectory,
  resolveContainedPath,
  sanitizeEntryName,
  writeFileNoFollow,
} from './containment.js';
import { isProcessableEntry, stripEntryName } from './entry-path.js';
import type { Options, ZipEntry } from './types.js';
import { openZipFile } from './zip-reader.js';

const debug = debuglog('zippogryph');

const IFMT = 0o170000;
const IFDIR = 0o040000;
const IFLNK = 0o120000;

function classifyEntry(entry: ZipEntry): { isDirectory: boolean; isSymlink: boolean } {
  const mode = (entry.externalFileAttributes >> 16) & 0xffff;
  const isSymlink = (mode & IFMT) === IFLNK;
  let isDirectory = (mode & IFMT) === IFDIR;
  if (!isDirectory && entry.fileName.endsWith('/')) {
    isDirectory = true;
  }
  const madeBy = entry.versionMadeBy >> 8;
  if (!isDirectory) {
    isDirectory = madeBy === 0 && entry.externalFileAttributes === 16;
  }
  return { isDirectory, isSymlink };
}

function getExtractedMode(entryMode: number, isDir: boolean, opts: Options): number {
  let mode = entryMode;
  if (mode === 0) {
    if (isDir) {
      if (opts.defaultDirMode !== undefined) {
        mode = Number.parseInt(String(opts.defaultDirMode), 10);
      }
      if (!mode) {
        mode = 0o755;
      }
    } else {
      if (opts.defaultFileMode !== undefined) {
        mode = Number.parseInt(String(opts.defaultFileMode), 10);
      }
      if (!mode) {
        mode = 0o644;
      }
    }
  }
  return mode;
}

async function pathExists(destination: string): Promise<boolean> {
  try {
    await lstat(destination);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function listZip(
  zipPath: string,
  options: { strip?: number } = {},
): Promise<{ fileName: string; uncompressedSize: number }[]> {
  const stripCount = options.strip ?? 0;
  const zipReader = await openZipFile(zipPath);
  try {
    const listed: { fileName: string; uncompressedSize: number }[] = [];
    for (const entry of zipReader.entries) {
      if (!isProcessableEntry(entry.fileName, stripCount)) {
        continue;
      }
      const strippedName = stripEntryName(entry.fileName, stripCount);
      if (strippedName === undefined) {
        continue;
      }
      listed.push({ fileName: strippedName, uncompressedSize: entry.uncompressedSize });
    }
    return listed;
  } finally {
    await zipReader.close();
  }
}

export async function extract(zipPath: string, opts: Options): Promise<void> {
  if (!path.isAbsolute(opts.dir)) {
    throw new Error('Target directory is expected to be absolute');
  }

  debug('creating target directory %s', opts.dir);
  await mkdir(opts.dir, { recursive: true });
  const destRoot = await realpath(opts.dir);
  const options: Options = { ...opts, dir: destRoot };

  debug('opening %s', zipPath);
  const zipReader = await openZipFile(zipPath);
  const zipHandle = zipReader.getHandle();
  const stripCount = options.strip ?? 0;
  const processableCount = zipReader.entries.reduce(
    (count, entry) => (isProcessableEntry(entry.fileName, stripCount) ? count + 1 : count),
    0,
  );
  const progressHandle = { ...zipHandle, entryCount: processableCount };

  try {
    for (const entry of zipReader.entries) {
      debug('zipfile entry %s', entry.fileName);

      if (!isProcessableEntry(entry.fileName, stripCount)) {
        continue;
      }

      const strippedName = stripEntryName(entry.fileName, stripCount);
      if (strippedName === undefined) {
        continue;
      }

      options.onEntry?.(entry, progressHandle);

      const { isDirectory, isSymlink } = classifyEntry(entry);
      const mode = (entry.externalFileAttributes >> 16) & 0xffff;
      const extractedMode = getExtractedMode(mode, isDirectory, options) & 0o777;

      sanitizeEntryName(strippedName);
      const destination = resolveContainedPath(destRoot, strippedName);

      if (isDirectory) {
        await ensureContainedDirectory(destRoot, destination, extractedMode);
        continue;
      }

      if (options.noOverwrite && (await pathExists(destination))) {
        debug('skipping existing path %s', destination);
        continue;
      }

      await ensureContainedDirectory(destRoot, path.dirname(destination));

      if (isSymlink) {
        const linkTarget = await text(await zipReader.openEntryStream(entry));
        debug('creating symlink %s -> %s', destination, linkTarget);
        await createContainedSymlink(destRoot, destination, linkTarget);
        continue;
      }

      debug('extracting file %s', destination);
      const dataStream = await zipReader.openEntryStream(entry);
      await writeFileNoFollow(destination, dataStream, extractedMode);
    }
  } finally {
    await zipReader.close();
  }

  debug('zip extraction complete');
}
