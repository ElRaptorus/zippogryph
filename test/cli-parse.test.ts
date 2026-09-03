import { describe, expect, it } from 'vitest';

import { formatCliHelp, parseCliArguments, resolveCliCommandName } from '../src/cli-parse.js';

describe('CLI argument parsing', () => {
  it('parses archive and optional directory', () => {
    expect(parseCliArguments(['foo.zip'])).toEqual({
      kind: 'extract',
      source: 'foo.zip',
      destination: undefined,
      silent: false,
      strip: 0,
      noOverwrite: false,
    });
    expect(parseCliArguments(['foo.zip', '/tmp/out', '-s'])).toEqual({
      kind: 'extract',
      source: 'foo.zip',
      destination: '/tmp/out',
      silent: true,
      strip: 0,
      noOverwrite: false,
    });
  });

  it('treats --help and -h as help even when other arguments are present', () => {
    expect(parseCliArguments(['--help'])).toEqual({ kind: 'help' });
    expect(parseCliArguments(['foo.zip', '-h'])).toEqual({ kind: 'help' });
  });

  it('accepts --silent and -s', () => {
    expect(parseCliArguments(['--silent', 'foo.zip'])).toEqual({
      kind: 'extract',
      source: 'foo.zip',
      destination: undefined,
      silent: true,
      strip: 0,
      noOverwrite: false,
    });
  });

  it('parses version, list, strip, and no-overwrite flags', () => {
    expect(parseCliArguments(['-v'])).toEqual({ kind: 'version' });
    expect(parseCliArguments(['--list', 'foo.zip'])).toEqual({
      kind: 'list',
      source: 'foo.zip',
      strip: 0,
    });
    expect(parseCliArguments(['--strip', '2', '-n', 'foo.zip', '/tmp/out'])).toEqual({
      kind: 'extract',
      source: 'foo.zip',
      destination: '/tmp/out',
      silent: false,
      strip: 2,
      noOverwrite: true,
    });
    expect(parseCliArguments(['--strip=1', '-l', 'foo.zip'])).toEqual({
      kind: 'list',
      source: 'foo.zip',
      strip: 1,
    });
  });

  it('rejects invalid --strip values and a destination with --list', () => {
    expect(parseCliArguments(['--strip'])).toEqual({
      kind: 'error',
      message: 'Option --strip requires a non-negative integer.',
    });
    expect(parseCliArguments(['--strip', 'foo.zip'])).toEqual({
      kind: 'error',
      message: "Invalid --strip value 'foo.zip'.",
    });
    expect(parseCliArguments(['--strip=-1', 'foo.zip'])).toEqual({
      kind: 'error',
      message: "Invalid --strip value '-1'.",
    });
    expect(parseCliArguments(['-l', 'foo.zip', '/tmp/out'])).toEqual({
      kind: 'error',
      message: 'Listing does not take a destination directory.',
    });
  });

  it('rejects missing archive, unknown options, and extra positionals', () => {
    expect(parseCliArguments([])).toEqual({ kind: 'error', message: 'Missing archive path.' });
    expect(parseCliArguments(['--unknown'])).toEqual({
      kind: 'error',
      message: "Unknown option '--unknown'.",
    });
    expect(parseCliArguments(['a.zip', 'b', 'c'])).toEqual({
      kind: 'error',
      message: 'Too many arguments.',
    });
  });

  it('formats help with the invoked command name', () => {
    const help = formatCliHelp('zippogryph');
    expect(help).toContain('Usage: zippogryph [options] <archive> [directory]');
    expect(help).toContain('-s, --silent');
    expect(help).toContain('-l, --list');
    expect(help).toContain('--strip N');
    expect(help).toContain('-n, --no-overwrite');
    expect(help).toContain('-v, --version');
    expect(help).toContain('-h, --help');
  });

  it('maps the compiled cli filename to zippogryph', () => {
    expect(resolveCliCommandName('/repo/dist/cli.js')).toBe('zippogryph');
    expect(resolveCliCommandName('/usr/bin/extract-zip')).toBe('extract-zip');
  });
});
