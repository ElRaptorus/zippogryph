import type { Writable } from 'node:stream';

import type { ZipEntry, ZipHandle } from './types.js';

const BAR_WIDTH = 24;
const ERASE_TO_END_OF_LINE = '\x1b[K';

export function formatExtractionProgress(processed: number, total: number, barWidth = BAR_WIDTH): string {
  const clampedTotal = Math.max(0, total);
  const clampedProcessed = Math.max(0, processed);
  const ratio = clampedTotal === 0 ? 1 : Math.min(1, clampedProcessed / clampedTotal);
  const percent = Math.round(ratio * 100);
  const filledWidth = Math.round(ratio * barWidth);
  const bar = `${'#'.repeat(filledWidth)}${'-'.repeat(barWidth - filledWidth)}`;
  const percentLabel = `${String(percent).padStart(3, ' ')}%`;
  return `[${bar}] ${percentLabel}  ${clampedProcessed} / ${clampedTotal} processed`;
}

export function createExtractionProgress(outputStream: Writable): {
  onEntry(entry: ZipEntry, zipHandle: ZipHandle): void;
  finish(): void;
  abandon(): void;
} {
  let processed = 0;
  let total = 0;

  function render(): void {
    outputStream.write(`\r${formatExtractionProgress(processed, total)}${ERASE_TO_END_OF_LINE}`);
  }

  return {
    onEntry(_entry: ZipEntry, zipHandle: ZipHandle): void {
      total = zipHandle.entryCount;
      processed += 1;
      render();
    },
    finish(): void {
      render();
      outputStream.write('\n');
    },
    abandon(): void {
      outputStream.write('\n');
    },
  };
}
