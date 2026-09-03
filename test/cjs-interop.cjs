'use strict';

const { mkdtemp, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const extract = require('../dist/index.cjs');

if (typeof extract !== 'function') {
  throw new Error(`CJS export must be a function, got ${typeof extract}`);
}

async function main() {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'zippogryph-cjs-'));
  const zipPath = path.join(__dirname, 'fixtures', 'no-permissions.zip');
  await extract(zipPath, { dir: directoryPath });
  await stat(path.join(directoryPath, 'folder', 'file.txt'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
