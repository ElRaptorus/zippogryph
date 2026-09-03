import { describe, expect, it } from 'vitest';

import { isProcessableEntry, stripEntryName } from '../src/entry-path.js';

describe('entry path stripping', () => {
  it('strips leading components like tar --strip-components', () => {
    expect(stripEntryName('wrapper/src/index.ts', 0)).toBe('wrapper/src/index.ts');
    expect(stripEntryName('wrapper/src/index.ts', 1)).toBe('src/index.ts');
    expect(stripEntryName('wrapper/src/index.ts', 2)).toBe('index.ts');
    expect(stripEntryName('wrapper/src/index.ts', 3)).toBeUndefined();
    expect(stripEntryName('wrapper/src/', 1)).toBe('src/');
    expect(stripEntryName('wrapper/src/', 2)).toBeUndefined();
  });

  it('treats __MACOSX entries as not processable', () => {
    expect(isProcessableEntry('__MACOSX/._file', 0)).toBe(false);
    expect(isProcessableEntry('readme.txt', 0)).toBe(true);
    expect(isProcessableEntry('only-root.txt', 1)).toBe(false);
  });
});
