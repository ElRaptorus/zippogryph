import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { fixturePath } from './helpers.js';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('package interop', () => {
  it('declares bin paths without a leading ./ so npm publish keeps them', async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(packageJson.bin).toEqual({
      zippogryph: 'dist/cli.js',
      'extract-zip': 'dist/cli.js',
    });
  });

  it('exports a callable function from the CJS entry', async () => {
    await execFile(process.execPath, [path.join(repositoryRoot, 'test', 'cjs-interop.cjs')]);
  });

  it('extracts via the ESM default export from dist', async () => {
    const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'zippogryph-esm-dist-'));
    const distModuleUrl = pathToFileURL(path.join(repositoryRoot, 'dist', 'index.js')).href;
    const distModule = (await import(distModuleUrl)) as {
      default: (zipPath: string, options: { dir: string }) => Promise<void>;
    };
    await distModule.default(fixturePath('no-permissions.zip'), { dir: directoryPath });
    await expect(stat(path.join(directoryPath, 'folder', 'file.txt'))).resolves.toBeTruthy();
  });
});
