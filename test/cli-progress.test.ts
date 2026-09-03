import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createExtractionProgress, formatExtractionProgress } from '../src/cli-progress.js';
import type { ZipEntry, ZipHandle } from '../src/types.js';

function collectStream(): { stream: Writable; output: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });
  return {
    stream,
    output: () => output,
  };
}

function stubZipHandle(entryCount: number): ZipHandle {
  return {
    entryCount,
    isOpen: true,
    close(): void {},
  };
}

const stubEntry = { fileName: 'file.txt' } as ZipEntry;

describe('CLI progress', () => {
  it('formats a percentage, bar, and processed counter', () => {
    expect(formatExtractionProgress(0, 10)).toBe(`[------------------------]   0%  0 / 10 processed`);
    expect(formatExtractionProgress(5, 10)).toBe(`[############------------]  50%  5 / 10 processed`);
    expect(formatExtractionProgress(10, 10)).toBe(`[########################] 100%  10 / 10 processed`);
  });

  it('treats an empty archive as complete', () => {
    expect(formatExtractionProgress(0, 0)).toBe(`[########################] 100%  0 / 0 processed`);
  });

  it('rewrites the same line and ends with a newline on finish', () => {
    const collected = collectStream();
    const progress = createExtractionProgress(collected.stream);
    const zipHandle = stubZipHandle(2);
    progress.onEntry(stubEntry, zipHandle);
    progress.onEntry(stubEntry, zipHandle);
    progress.finish();
    expect(collected.output()).toBe(
      `\r[############------------]  50%  1 / 2 processed\x1b[K` +
        `\r[########################] 100%  2 / 2 processed\x1b[K` +
        `\r[########################] 100%  2 / 2 processed\x1b[K\n`,
    );
  });
});
