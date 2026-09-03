import { buffer as readStreamBuffer } from 'node:stream/consumers';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { MAX_CENTRAL_DIRECTORY_SIZE, openZipFile } from '../src/zip-reader.js';
import { makeTemporaryDirectory, patchZip32CentralDirectorySize, writeZipArchive } from './helpers.js';

describe('zip reader', () => {
  it('extracts a STORE entry', async () => {
    const directory = await makeTemporaryDirectory('store');
    const zipPath = path.join(directory, 'store.zip');
    await writeZipArchive(zipPath, [{ name: 'hello.txt', data: Buffer.from('hello world') }]);

    const reader = await openZipFile(zipPath);
    try {
      expect(reader.entries.map((entry) => entry.fileName)).toEqual(['hello.txt']);
      const contents = await readStreamBuffer(await reader.openEntryStream(reader.entries[0]!));
      expect(contents.toString('utf8')).toBe('hello world');
    } finally {
      await reader.close();
    }
  });

  it('extracts a DEFLATE entry', async () => {
    const directory = await makeTemporaryDirectory('deflate');
    const zipPath = path.join(directory, 'deflate.zip');
    await writeZipArchive(zipPath, [{ name: 'hello.txt', data: Buffer.from('hello deflate'), method: 8 }]);

    const reader = await openZipFile(zipPath);
    try {
      const contents = await readStreamBuffer(await reader.openEntryStream(reader.entries[0]!));
      expect(contents.toString('utf8')).toBe('hello deflate');
    } finally {
      await reader.close();
    }
  });

  it('lists directory entries', async () => {
    const directory = await makeTemporaryDirectory('dir-entry');
    const zipPath = path.join(directory, 'dir.zip');
    await writeZipArchive(zipPath, [{ name: 'dir/', data: Buffer.alloc(0) }]);

    const reader = await openZipFile(zipPath);
    try {
      expect(reader.entries.map((entry) => entry.fileName)).toEqual(['dir/']);
    } finally {
      await reader.close();
    }
  });

  it('throws on a broken central directory signature', async () => {
    const directory = await makeTemporaryDirectory('broken');
    const zipPath = path.join(directory, 'broken.zip');
    await writeFile(zipPath, Buffer.from('this is not a zip file'));
    await expect(openZipFile(zipPath)).rejects.toThrow();
  });

  it('decodes UTF-8 entry names when the language encoding flag is set', async () => {
    const directory = await makeTemporaryDirectory('utf8');
    const zipPath = path.join(directory, 'utf8.zip');
    await writeZipArchive(zipPath, [{ name: 'café.txt', data: Buffer.from('espresso'), utf8: true }]);

    const reader = await openZipFile(zipPath);
    try {
      expect(reader.entries[0]?.fileName).toBe('café.txt');
      const contents = await readStreamBuffer(await reader.openEntryStream(reader.entries[0]!));
      expect(contents.toString('utf8')).toBe('espresso');
    } finally {
      await reader.close();
    }
  });
});

describe('central directory size cap', () => {
  it('opens a zip whose central directory is within the cap', async () => {
    const directory = await makeTemporaryDirectory('cd-cap-ok');
    const zipPath = path.join(directory, 'ok.zip');
    await writeZipArchive(zipPath, [{ name: 'hello.txt', data: Buffer.from('hello') }]);

    const reader = await openZipFile(zipPath);
    try {
      expect(reader.entries.map((entry) => entry.fileName)).toEqual(['hello.txt']);
    } finally {
      await reader.close();
    }
  });

  it('rejects a zip whose end of central directory claims a too-large central directory', async () => {
    const directory = await makeTemporaryDirectory('cd-cap-over');
    const zipPath = path.join(directory, 'oversize-cd.zip');
    await writeZipArchive(zipPath, [{ name: 'hello.txt', data: Buffer.from('hello') }]);
    await patchZip32CentralDirectorySize(zipPath, MAX_CENTRAL_DIRECTORY_SIZE + 1);

    await expect(openZipFile(zipPath)).rejects.toThrow(/Central directory is too large/);
  });
});

describe('inflate output cap', () => {
  it('rejects DEFLATE output that exceeds the declared uncompressed size', async () => {
    const directory = await makeTemporaryDirectory('inflate-overrun');
    const zipPath = path.join(directory, 'overrun.zip');
    await writeZipArchive(zipPath, [
      {
        name: 'payload.bin',
        data: Buffer.alloc(100, 0x61),
        method: 8,
        declaredUncompressedSize: 10,
      },
    ]);

    const reader = await openZipFile(zipPath);
    try {
      await expect(readStreamBuffer(await reader.openEntryStream(reader.entries[0]!))).rejects.toThrow(
        /Inflated output exceeds declared uncompressed size/,
      );
    } finally {
      await reader.close();
    }
  });

  it('rejects a STORE entry whose compressed size does not match uncompressed size', async () => {
    const directory = await makeTemporaryDirectory('store-mismatch');
    const zipPath = path.join(directory, 'mismatch.zip');
    await writeZipArchive(zipPath, [
      {
        name: 'hello.txt',
        data: Buffer.from('hello'),
        declaredUncompressedSize: 10,
      },
    ]);

    const reader = await openZipFile(zipPath);
    try {
      await expect(reader.openEntryStream(reader.entries[0]!)).rejects.toThrow(
        /compressed size does not match uncompressed size/,
      );
    } finally {
      await reader.close();
    }
  });
});
