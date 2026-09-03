import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  OutOfBoundPathError,
  createContainedSymlink,
  ensureContainedDirectory,
  resolveContainedPath,
  sanitizeEntryName,
  writeFileNoFollow,
} from '../src/containment.js';
import { extract } from '../src/extract.js';
import {
  UNIX_FILE_ATTRIBUTES,
  UNIX_SYMLINK_ATTRIBUTES,
  fixturePath,
  makeTemporaryDirectory,
  writeZipArchive,
} from './helpers.js';

describe('containment', () => {
  it('rejects empty names, NUL bytes, absolute paths, and parent segments', () => {
    expect(() => sanitizeEntryName('')).toThrow(/empty/);
    expect(() => sanitizeEntryName('a\0b')).toThrow(/NUL/);
    expect(() => sanitizeEntryName('/etc/passwd')).toThrow(OutOfBoundPathError);
    expect(() => sanitizeEntryName('C:\\Windows\\system32')).toThrow(OutOfBoundPathError);
    expect(() => sanitizeEntryName('../outside.txt')).toThrow(OutOfBoundPathError);
    expect(() => sanitizeEntryName('foo/../../outside.txt')).toThrow(OutOfBoundPathError);
  });

  it('resolves contained paths under the destination root', async () => {
    const destRoot = await makeTemporaryDirectory('contained');
    expect(resolveContainedPath(destRoot, 'foo/bar.txt')).toBe(path.join(destRoot, 'foo', 'bar.txt'));
  });

  it('does not write through a planted symlink', async () => {
    const destRoot = await makeTemporaryDirectory('nofollow');
    const outside = path.join(os.tmpdir(), `zippogryph-outside-${process.pid}.txt`);
    await writeFile(outside, 'untouched');
    const planted = path.join(destRoot, 'payload');
    await symlink(outside, planted);

    await writeFileNoFollow(planted, Readable.from(Buffer.from('pwned')), 0o644);

    expect(await readFile(outside, 'utf8')).toBe('untouched');
    const stats = await lstat(planted);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(await readFile(planted, 'utf8')).toBe('pwned');
  });

  it('rejects an intermediate directory that is a symlink leaving the destination', async () => {
    const destRoot = await makeTemporaryDirectory('dir-symlink');
    const outside = await makeTemporaryDirectory('dir-symlink-outside');
    await symlink(outside, path.join(destRoot, 'sub'));
    await expect(ensureContainedDirectory(destRoot, path.join(destRoot, 'sub', 'nested'))).rejects.toThrow(
      OutOfBoundPathError,
    );
  });

  it('rejects symlink targets that resolve outside the destination', async () => {
    const destRoot = await makeTemporaryDirectory('symlink-escape');
    await expect(createContainedSymlink(destRoot, path.join(destRoot, 'link'), '/tmp/outside')).rejects.toThrow(
      OutOfBoundPathError,
    );
    await expect(createContainedSymlink(destRoot, path.join(destRoot, 'link'), '../outside')).rejects.toThrow(
      OutOfBoundPathError,
    );
  });
});

describe('CVE-2026-19693', () => {
  it('does not write through a zip that plants an escaping symlink then a file of the same name', async () => {
    const destRoot = await makeTemporaryDirectory('cve-escape');
    const outside = path.join(os.tmpdir(), `zippogryph-cve-outside-${process.pid}.txt`);
    await writeFile(outside, 'untouched');

    const zipPath = path.join(destRoot, 'attack.zip');
    await writeZipArchive(zipPath, [
      {
        name: 'payload',
        data: Buffer.from(outside),
        externalFileAttributes: UNIX_SYMLINK_ATTRIBUTES,
      },
      {
        name: 'payload',
        data: Buffer.from('pwned'),
        externalFileAttributes: UNIX_FILE_ATTRIBUTES,
      },
    ]);

    await expect(extract(zipPath, { dir: destRoot })).rejects.toThrow(OutOfBoundPathError);
    expect(await readFile(outside, 'utf8')).toBe('untouched');
  });

  it('replaces a contained symlink with a later regular file of the same name', async () => {
    const destRoot = await makeTemporaryDirectory('cve-replace');
    await writeFile(path.join(destRoot, 'ok.txt'), 'safe');

    const zipPath = path.join(destRoot, 'replace.zip');
    await writeZipArchive(zipPath, [
      {
        name: 'payload',
        data: Buffer.from('ok.txt'),
        externalFileAttributes: UNIX_SYMLINK_ATTRIBUTES,
      },
      {
        name: 'payload',
        data: Buffer.from('pwned'),
        externalFileAttributes: UNIX_FILE_ATTRIBUTES,
      },
    ]);

    await extract(zipPath, { dir: destRoot });

    const stats = await lstat(path.join(destRoot, 'payload'));
    expect(stats.isSymbolicLink()).toBe(false);
    expect(await readFile(path.join(destRoot, 'payload'), 'utf8')).toBe('pwned');
    expect(await readFile(path.join(destRoot, 'ok.txt'), 'utf8')).toBe('safe');
  });

  it('rejects classic zip-slip file names', async () => {
    const destRoot = await makeTemporaryDirectory('zip-slip');
    const zipPath = path.join(destRoot, 'slip.zip');
    await writeZipArchive(zipPath, [
      {
        name: '../../outside.txt',
        data: Buffer.from('nope'),
        externalFileAttributes: UNIX_FILE_ATTRIBUTES,
      },
    ]);

    await expect(extract(zipPath, { dir: destRoot })).rejects.toThrow(OutOfBoundPathError);
  });

  it('rejects a directory symlink then a nested file (extract-zip symlink-dest fixture)', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const destRoot = await makeTemporaryDirectory('symlink-dest');
    await expect(extract(fixturePath('symlink-dest.zip'), { dir: destRoot })).rejects.toThrow(/Out of bound path/);
  });

  it('does not write through an intermediate directory that is already a symlink', async () => {
    const destRoot = await makeTemporaryDirectory('planted-dir');
    const outside = await makeTemporaryDirectory('planted-dir-outside');
    await mkdir(path.join(destRoot, 'keep'));
    await symlink(outside, path.join(destRoot, 'sub'));

    const zipPath = path.join(destRoot, 'nested.zip');
    await writeZipArchive(zipPath, [
      {
        name: 'sub/file.txt',
        data: Buffer.from('escaped'),
        externalFileAttributes: UNIX_FILE_ATTRIBUTES,
      },
    ]);

    await expect(extract(zipPath, { dir: destRoot })).rejects.toThrow(OutOfBoundPathError);
    await expect(readFile(path.join(outside, 'file.txt'), 'utf8')).rejects.toThrow();
  });
});
