#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createExtractionProgress } from './cli-progress.js';
import { formatCliHelp, parseCliArguments, resolveCliCommandName } from './cli-parse.js';
import { extract, listZip } from './extract.js';

const RED = '\u001b[31m';
const RESET = '\u001b[0m';

function printError(message: string): void {
  const useColor = Boolean(process.stderr.isTTY) && !('NO_COLOR' in process.env);
  console.error(useColor ? `${RED}${message}${RESET}` : message);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

async function readPackageVersion(): Promise<string> {
  const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: string };
  return packageJson.version ?? '0.0.0';
}

const commandName = resolveCliCommandName(process.argv[1]);
const parsed = parseCliArguments(process.argv.slice(2));

if (parsed.kind === 'help') {
  console.log(formatCliHelp(commandName));
  process.exit(0);
}

if (parsed.kind === 'version') {
  console.log(`${commandName} ${await readPackageVersion()}`);
  process.exit(0);
}

if (parsed.kind === 'error') {
  printError(parsed.message);
  console.error('');
  console.error(formatCliHelp(commandName));
  process.exit(1);
}

if (parsed.kind === 'list') {
  try {
    const entries = await listZip(path.resolve(parsed.source), { strip: parsed.strip });
    for (const entry of entries) {
      const sizeLabel = String(entry.uncompressedSize).padStart(12, ' ');
      console.log(`${sizeLabel}  ${entry.fileName}`);
    }
  } catch (error: unknown) {
    printError(formatUnknownError(error));
    process.exit(1);
  }
  process.exit(0);
}

const destination = path.resolve(parsed.destination ?? process.cwd());
const progress = parsed.silent || !process.stderr.isTTY ? undefined : createExtractionProgress(process.stderr);

extract(path.resolve(parsed.source), {
  dir: destination,
  onEntry: progress?.onEntry,
  strip: parsed.strip,
  noOverwrite: parsed.noOverwrite,
})
  .then(() => {
    progress?.finish();
    console.log('Finished.');
  })
  .catch((error: unknown) => {
    progress?.abandon();
    printError(formatUnknownError(error));
    process.exit(1);
  });
