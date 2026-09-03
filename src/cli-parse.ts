export type ParsedCliArguments =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'list'; source: string; strip: number }
  | {
      kind: 'extract';
      source: string;
      destination: string | undefined;
      silent: boolean;
      strip: number;
      noOverwrite: boolean;
    }
  | { kind: 'error'; message: string };

function parseStripCount(value: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

export function parseCliArguments(argumentsList: string[]): ParsedCliArguments {
  let silent = false;
  let help = false;
  let version = false;
  let list = false;
  let noOverwrite = false;
  let strip = 0;
  const positionals: string[] = [];

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--version' || argument === '-v') {
      version = true;
      continue;
    }
    if (argument === '--silent' || argument === '-s') {
      silent = true;
      continue;
    }
    if (argument === '--list' || argument === '-l') {
      list = true;
      continue;
    }
    if (argument === '--no-overwrite' || argument === '-n') {
      noOverwrite = true;
      continue;
    }
    if (argument === '--strip' || argument.startsWith('--strip=')) {
      let rawValue: string | undefined;
      if (argument === '--strip') {
        rawValue = argumentsList[index + 1];
        index += 1;
        if (rawValue === undefined || rawValue.startsWith('-')) {
          return { kind: 'error', message: 'Option --strip requires a non-negative integer.' };
        }
      } else {
        rawValue = argument.slice('--strip='.length);
      }
      const parsedStrip = parseStripCount(rawValue);
      if (parsedStrip === undefined) {
        return { kind: 'error', message: `Invalid --strip value '${rawValue}'.` };
      }
      strip = parsedStrip;
      continue;
    }
    if (argument.startsWith('-')) {
      return { kind: 'error', message: `Unknown option '${argument}'.` };
    }
    positionals.push(argument);
  }

  if (help) {
    return { kind: 'help' };
  }
  if (version) {
    return { kind: 'version' };
  }

  const source = positionals[0];
  if (!source) {
    return { kind: 'error', message: 'Missing archive path.' };
  }

  if (list) {
    if (positionals.length > 1) {
      return { kind: 'error', message: 'Listing does not take a destination directory.' };
    }
    return { kind: 'list', source, strip };
  }

  if (positionals.length > 2) {
    return { kind: 'error', message: 'Too many arguments.' };
  }

  return {
    kind: 'extract',
    source,
    destination: positionals[1],
    silent,
    strip,
    noOverwrite,
  };
}

export function formatCliHelp(commandName: string): string {
  return [
    `Usage: ${commandName} [options] <archive> [directory]`,
    '',
    'Extract a zip archive.',
    '',
    'Arguments:',
    '  archive      Path to the zip file',
    '  directory    Destination directory (default: current working directory)',
    '',
    'Options:',
    '  -l, --list            List archive contents and exit',
    '  -n, --no-overwrite    Do not overwrite existing files',
    '  -s, --silent          Do not show the progress bar',
    '      --strip N         Strip N leading path components',
    '  -v, --version         Print the version',
    '  -h, --help            Show this help',
  ].join('\n');
}

export function resolveCliCommandName(argv1: string | undefined): string {
  const baseName = argv1?.split(/[/\\]/).pop() ?? 'zippogryph';
  const withoutExtension = baseName.replace(/\.(js|cjs|mjs)$/u, '');
  if (withoutExtension === 'cli' || withoutExtension === '') {
    return 'zippogryph';
  }
  return withoutExtension;
}
