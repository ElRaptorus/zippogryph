# Zippogryph

Drop-in replacement for [`extract-zip`](https://www.npmjs.com/package/extract-zip). It extracts ZIP archives, using only Node.js builtin libs. Zero external dependencies.

Should work with all current LTS Versions of NodeJS. ESM and CommonJS supported.

Requires Node.js `>=22.12.0`.

## Why

`extract-zip` has not been maintained for years and has security issues like [CVE-2026-19693](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3). \
Got bored and thought a rewrite is more exciting than another fork.
Who knows, maybe somebody will even find this useful.

## Usage

```bash
npm install @elraptorus/zippogryph
```

The lib is available on `NPM` and via `GitHub Package` registry. Use whichever you prefer.

> You could also create an override in your package.json to have extract-zip point here instead, but beware: **Danger, Will Robinson.**.

You can import and use it like this:

```javascript
// ESM
import extract from '@elraptorus/zippogryph';

// CommonJS
const extract = require('@elraptorus/zippogryph');

await extract('/absolute/path/to/file.zip', { dir: '/absolute/path/to/dest' });
```

### CLI

Examples:

```bash
npx zippogryph foo.zip /path/to/target/dir
npx extract-zip foo.zip /path/to/target/dir
npx zippogryph --list foo.zip
npx zippogryph --strip 1 foo.zip /path/to/target/dir
npx zippogryph --no-overwrite foo.zip /path/to/target/dir
npx zippogryph --silent foo.zip /path/to/target/dir
```

- `/path/to/target/dir` must be an absolute path
- If the target directory is omitted, the current working directory is used
- `--strip N` drops N leading path components (like `tar --strip-components`)
- `-n` / `--no-overwrite` leaves existing files unchanged
- `-l` / `--list` prints sizes and paths without extracting
- `-s` / `--silent` turns the progress report off

### Options

| Option            | Type                       | Default  | Description                                                                                                                                                                                                    |
| ----------------- | -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`             | `string`                   | required | Absolute destination directory                                                                                                                                                                                 |
| `defaultDirMode`  | `number`                   | `0o755`  | Directory mode when the zip does not set permissions                                                                                                                                                           |
| `defaultFileMode` | `number`                   | `0o644`  | File mode when the zip does not set permissions                                                                                                                                                                |
| `onEntry`         | `(entry, zipfile) => void` | —        | Called for each extracted zip entry (`__MACOSX/` is skipped). `zipfile.entryCount` is the number of extractable entries. `zipfile` is a small handle (`entryCount`, `isOpen`, `close`), not a yauzl `ZipFile`. |
| `strip`           | `number`                   | `0`      | Number of leading path components to remove from each entry                                                                                                                                                    |
| `noOverwrite`     | `boolean`                  | `false`  | Skip files and symlinks that already exist at the destination                                                                                                                                                  |

Entries under `__MACOSX/` are skipped. Compression methods `0` (STORE) and `8` (DEFLATE) are supported. Encrypted or other methods throw. The central directory is capped at 64 MiB.

## License

MIT.
