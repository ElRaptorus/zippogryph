import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile, readlink, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { extract, listZip } from '../src/extract.js';
import { fixturePath, makeTemporaryDirectory, writeZipArchive } from './helpers.js';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativeTarget = path.join(repositoryRoot, 'cats');

async function temporaryExtract(suffix: string, zipPath: string): Promise<string> {
  const directoryPath = await makeTemporaryDirectory(suffix);
  await extract(zipPath, { dir: directoryPath });
  return directoryPath;
}

describe('extract', () => {
  it('extracts files', async () => {
    const directoryPath = await temporaryExtract('files', fixturePath('cats.zip'));
    await expect(stat(path.join(directoryPath, 'cats', 'gJqEYBs.jpg'))).resolves.toBeTruthy();
  });

  it('extracts symlinks', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directoryPath = await temporaryExtract('symlinks', fixturePath('cats.zip'));
    const symlinkPath = path.join(directoryPath, 'cats', 'orange_symlink');
    await expect(stat(path.join(directoryPath, 'cats'))).resolves.toBeTruthy();
    const stats = await lstat(symlinkPath);
    expect(stats.isSymbolicLink()).toBe(true);
    expect(await readlink(symlinkPath)).toBe('orange');
  });

  it('extracts directories including empty ones', async () => {
    const directoryPath = await temporaryExtract('directories', fixturePath('cats.zip'));
    const dirWithContent = path.join(directoryPath, 'cats', 'orange');
    const dirWithoutContent = path.join(directoryPath, 'cats', 'empty');

    const filesWithContent = await readdir(dirWithContent);
    expect(filesWithContent.length).not.toBe(0);

    const filesWithoutContent = await readdir(dirWithoutContent);
    expect(filesWithoutContent.length).toBe(0);
  });

  it('extracts a github-style zip', async () => {
    const directoryPath = await temporaryExtract('verify-extraction', fixturePath('github.zip'));
    await expect(stat(path.join(directoryPath, 'extract-zip-master', 'test'))).resolves.toBeTruthy();
    if (process.platform !== 'win32') {
      const stats = await stat(path.join(directoryPath, 'extract-zip-master', 'test'));
      expect(stats.mode & 0o777).toBe(0o755);
    }
  });

  it('calls opts.onEntry with each file name', async () => {
    const directoryPath = await makeTemporaryDirectory('onEntry');
    const actualEntries: string[] = [];
    await extract(fixturePath('symlink.zip'), {
      dir: directoryPath,
      onEntry: (entry) => {
        actualEntries.push(entry.fileName);
      },
    });
    expect(actualEntries).toEqual(['symlink/', 'symlink/foo.txt', 'symlink/foo_symlink.txt']);
  });

  it('excludes __MACOSX entries from onEntry zipfile.entryCount', async () => {
    const directoryPath = await makeTemporaryDirectory('macosx-entry-count');
    const zipPath = path.join(directoryPath, 'mixed.zip');
    await writeZipArchive(zipPath, [
      { name: 'readme.txt', data: Buffer.from('ok') },
      { name: '__MACOSX/._readme.txt', data: Buffer.from('meta') },
      { name: 'src/main.js', data: Buffer.from('console.log(1)') },
      { name: '__MACOSX/src/._main.js', data: Buffer.from('meta') },
    ]);
    const reportedCounts: number[] = [];
    const reportedNames: string[] = [];
    await extract(zipPath, {
      dir: directoryPath,
      onEntry: (entry, zipfile) => {
        reportedNames.push(entry.fileName);
        reportedCounts.push(zipfile.entryCount);
      },
    });
    expect(reportedNames).toEqual(['readme.txt', 'src/main.js']);
    expect(reportedCounts).toEqual([2, 2]);
  });

  it('strips leading path components', async () => {
    const directoryPath = await makeTemporaryDirectory('strip');
    const zipPath = path.join(directoryPath, 'nested.zip');
    await writeZipArchive(zipPath, [
      { name: 'wrapper/readme.txt', data: Buffer.from('hello') },
      { name: 'wrapper/src/main.js', data: Buffer.from('ok') },
    ]);
    await extract(zipPath, { dir: directoryPath, strip: 1 });
    await expect(readFile(path.join(directoryPath, 'readme.txt'), 'utf8')).resolves.toBe('hello');
    await expect(readFile(path.join(directoryPath, 'src', 'main.js'), 'utf8')).resolves.toBe('ok');
  });

  it('skips existing files when noOverwrite is set', async () => {
    const directoryPath = await makeTemporaryDirectory('no-overwrite');
    const zipPath = path.join(directoryPath, 'files.zip');
    await writeZipArchive(zipPath, [{ name: 'kept.txt', data: Buffer.from('from-zip') }]);
    await extract(zipPath, { dir: directoryPath });
    await writeFile(path.join(directoryPath, 'kept.txt'), 'local');
    await extract(zipPath, { dir: directoryPath, noOverwrite: true });
    await expect(readFile(path.join(directoryPath, 'kept.txt'), 'utf8')).resolves.toBe('local');
  });

  it('lists extractable entries and applies strip', async () => {
    const directoryPath = await makeTemporaryDirectory('list-zip');
    const zipPath = path.join(directoryPath, 'mixed.zip');
    await writeZipArchive(zipPath, [
      { name: 'wrapper/readme.txt', data: Buffer.from('hello') },
      { name: '__MACOSX/._readme.txt', data: Buffer.from('meta') },
    ]);
    await expect(listZip(zipPath)).resolves.toEqual([{ fileName: 'wrapper/readme.txt', uncompressedSize: 5 }]);
    await expect(listZip(zipPath, { strip: 1 })).resolves.toEqual([{ fileName: 'readme.txt', uncompressedSize: 5 }]);
  });

  it('rejects a relative target directory', async () => {
    await rm(relativeTarget, { recursive: true, force: true });
    await expect(extract(fixturePath('cats.zip'), { dir: './cats' })).rejects.toThrow(
      'Target directory is expected to be absolute',
    );
    await expect(stat(relativeTarget)).rejects.toThrow();
    await rm(relativeTarget, { recursive: true, force: true });
  });

  it('disallows a symlink destination that escapes the target', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directoryPath = await makeTemporaryDirectory('symlink-destination-disallowed');
    await expect(extract(fixturePath('symlink-dest.zip'), { dir: directoryPath })).rejects.toThrow(/Out of bound path/);
  });

  it('does not create a file out of bounds', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directoryPath = await makeTemporaryDirectory('out-of-bounds-file');
    await expect(extract(fixturePath('symlink-dest.zip'), { dir: directoryPath })).rejects.toThrow();

    const symlinkDestDir = path.join(directoryPath, 'symlink-dest');
    await expect(stat(symlinkDestDir)).resolves.toBeTruthy();
    await expect(stat(path.join(symlinkDestDir, 'ccc', 'file.txt'))).rejects.toThrow();
    await expect(stat(path.join(directoryPath, 'file.txt'))).rejects.toThrow();
  });

  it('honours defaultDirMode', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directoryPath = await makeTemporaryDirectory('default-dir-mode');
    const defaultDirMode = 0o700;
    await extract(fixturePath('github.zip'), { dir: directoryPath, defaultDirMode });
    const stats = await stat(path.join(directoryPath, 'extract-zip-master', 'test'));
    expect(stats.mode & 0o777).toBe(defaultDirMode);
  });

  it('uses 0o644 when defaultFileMode is not set', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directoryPath = await makeTemporaryDirectory('default-file-mode');
    await extract(fixturePath('no-permissions.zip'), { dir: directoryPath });
    const stats = await stat(path.join(directoryPath, 'folder', 'file.txt'));
    expect(stats.mode & 0o777).toBe(0o644);
  });

  it('honours defaultFileMode', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directoryPath = await makeTemporaryDirectory('default-file-mode-set');
    const defaultFileMode = 0o600;
    await extract(fixturePath('no-permissions.zip'), { dir: directoryPath, defaultFileMode });
    const stats = await stat(path.join(directoryPath, 'folder', 'file.txt'));
    expect(stats.mode & 0o777).toBe(defaultFileMode);
  });

  it('extracts files in subdirs that have no directory entry', async () => {
    const directoryPath = await temporaryExtract('subdir-file', fixturePath('file-in-subdir-without-subdir-entry.zip'));
    await expect(stat(path.join(directoryPath, 'foo', 'bar'))).resolves.toBeTruthy();
  });

  it('throws when extracting a broken zip', async () => {
    const directoryPath = await makeTemporaryDirectory('broken-zip');
    await expect(extract(fixturePath('broken.zip'), { dir: directoryPath })).rejects.toThrow();
  });

  it('rejects a zip whose header CRC is 0 but the payload is not', async () => {
    const directoryPath = await makeTemporaryDirectory('crc-zero-extract');
    const zipPath = path.join(directoryPath, 'crc0.zip');
    await writeZipArchive(zipPath, [{ name: 'hello.txt', data: Buffer.from('hello'), crc32: 0 }]);
    await expect(extract(zipPath, { dir: directoryPath })).rejects.toThrow(/CRC-32 mismatch/);
  });

  it('extracts via the CLI', async () => {
    const directoryPath = await makeTemporaryDirectory('cli');
    const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
    await execFile(process.execPath, [cliPath, fixturePath('cats.zip'), directoryPath]);
    await expect(stat(path.join(directoryPath, 'cats', 'gJqEYBs.jpg'))).resolves.toBeTruthy();
  });

  it('prints help on --help and on missing arguments', async () => {
    const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
    const help = await execFile(process.execPath, [cliPath, '--help']);
    expect(help.stdout).toContain('Usage: zippogryph [options] <archive> [directory]');
    expect(help.stdout).toContain('-s, --silent');

    await expect(execFile(process.execPath, [cliPath])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Missing archive path.'),
    });
    await expect(execFile(process.execPath, [cliPath])).rejects.toMatchObject({
      stderr: expect.stringContaining('Usage: zippogryph [options] <archive> [directory]'),
    });
  });

  it('prints the version, lists an archive, and strips via the CLI', async () => {
    const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
    const versionResult = await execFile(process.execPath, [cliPath, '--version']);
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(versionResult.stdout.trim()).toBe(`zippogryph ${packageJson.version}`);

    const listed = await execFile(process.execPath, [cliPath, '--list', fixturePath('no-permissions.zip')]);
    expect(listed.stdout).toContain('folder/file.txt');

    const directoryPath = await makeTemporaryDirectory('cli-strip');
    const zipPath = path.join(directoryPath, 'nested.zip');
    await writeZipArchive(zipPath, [{ name: 'wrapper/hello.txt', data: Buffer.from('hi') }]);
    await execFile(process.execPath, [cliPath, '--strip', '1', zipPath, directoryPath]);
    await expect(readFile(path.join(directoryPath, 'hello.txt'), 'utf8')).resolves.toBe('hi');
  });

  it('suppresses progress with --silent', async () => {
    const directoryPath = await makeTemporaryDirectory('cli-silent');
    const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
    const result = await execFile(process.execPath, [cliPath, '--silent', fixturePath('cats.zip'), directoryPath]);
    expect(result.stderr).not.toContain('processed');
    await expect(stat(path.join(directoryPath, 'cats', 'gJqEYBs.jpg'))).resolves.toBeTruthy();
  });
});
