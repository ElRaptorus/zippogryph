import { constants } from 'node:fs';
import { lstat, mkdir, open, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export class OutOfBoundPathError extends Error {
  constructor(canonicalDest: string, fileName: string) {
    super(`Out of bound path "${canonicalDest}" found while processing file ${fileName}`);
    this.name = 'OutOfBoundPathError';
  }
}

function isOutOfBounds(destRoot: string, absPath: string): boolean {
  const relative = path.relative(destRoot, absPath);
  if (relative === '') {
    return false;
  }
  return relative.startsWith('..') || path.isAbsolute(relative);
}

export function sanitizeEntryName(fileName: string): string {
  if (fileName.length === 0) {
    throw new Error('Zip entry name is empty');
  }
  if (fileName.includes('\0')) {
    throw new Error('Zip entry name contains a NUL byte');
  }
  const normalised = fileName.replaceAll('\\', '/');
  if (normalised.startsWith('/') || normalised.startsWith('//')) {
    throw new OutOfBoundPathError(normalised, fileName);
  }
  if (/^[a-zA-Z]:/.test(normalised)) {
    throw new OutOfBoundPathError(normalised, fileName);
  }
  const segments = normalised.split('/');
  for (const segment of segments) {
    if (segment === '..') {
      throw new OutOfBoundPathError(normalised, fileName);
    }
  }
  return normalised;
}

export function resolveContainedPath(destRoot: string, fileName: string): string {
  const sanitised = sanitizeEntryName(fileName);
  const resolved = path.resolve(destRoot, sanitised);
  if (isOutOfBounds(destRoot, resolved)) {
    throw new OutOfBoundPathError(resolved, fileName);
  }
  return resolved;
}

export async function ensureContainedDirectory(destRoot: string, absDir: string, mode?: number): Promise<void> {
  const resolvedDir = path.resolve(absDir);
  if (isOutOfBounds(destRoot, resolvedDir) && resolvedDir !== destRoot) {
    throw new OutOfBoundPathError(resolvedDir, absDir);
  }

  const relative = path.relative(destRoot, resolvedDir);
  if (relative === '') {
    try {
      const stats = await lstat(destRoot);
      if (stats.isSymbolicLink()) {
        throw new OutOfBoundPathError(destRoot, absDir);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        await mkdir(destRoot, { recursive: true, mode: mode ?? 0o755 });
        return;
      }
      throw error;
    }
    return;
  }

  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  let current = destRoot;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    current = path.join(current, segment);
    const isLeaf = index === segments.length - 1;
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new OutOfBoundPathError(current, absDir);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Expected a directory at "${current}"`);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        await mkdir(current, { mode: isLeaf && mode !== undefined ? mode : 0o755 });
        continue;
      }
      throw error;
    }
  }
}

export async function writeFileNoFollow(absFile: string, contents: Readable, mode: number): Promise<void> {
  try {
    const stats = await lstat(absFile);
    if (stats.isDirectory()) {
      throw new Error(`Refusing to overwrite directory "${absFile}"`);
    }
    await unlink(absFile);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  const fileHandle = await open(absFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    await pipeline(contents, fileHandle.createWriteStream());
  } finally {
    await fileHandle.close();
  }
}

export async function createContainedSymlink(destRoot: string, absLinkPath: string, linkTarget: string): Promise<void> {
  if (linkTarget.includes('\0')) {
    throw new Error('Symlink target contains a NUL byte');
  }
  if (path.isAbsolute(linkTarget) || /^[a-zA-Z]:/.test(linkTarget) || linkTarget.startsWith('\\\\')) {
    throw new OutOfBoundPathError(linkTarget, path.basename(absLinkPath));
  }

  const parent = path.dirname(absLinkPath);
  const resolvedTarget = path.resolve(parent, linkTarget);
  if (isOutOfBounds(destRoot, resolvedTarget)) {
    throw new OutOfBoundPathError(resolvedTarget, path.basename(absLinkPath));
  }

  try {
    const stats = await lstat(absLinkPath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      throw new Error(`Refusing to replace directory "${absLinkPath}" with a symlink`);
    }
    await unlink(absLinkPath);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  await symlink(linkTarget, absLinkPath);
}
