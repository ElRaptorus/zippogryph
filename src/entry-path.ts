export function isMacOsMetadataEntry(fileName: string): boolean {
  return fileName.startsWith('__MACOSX/');
}

export function stripEntryName(fileName: string, stripCount: number): string | undefined {
  if (!Number.isInteger(stripCount) || stripCount < 0) {
    throw new Error('strip must be a non-negative integer');
  }

  const normalised = fileName.replaceAll('\\', '/');
  if (stripCount === 0) {
    return normalised;
  }

  const isDirectory = normalised.endsWith('/');
  const segments = normalised.split('/').filter((segment) => segment.length > 0);
  if (stripCount >= segments.length) {
    return undefined;
  }

  const remaining = segments.slice(stripCount).join('/');
  return isDirectory ? `${remaining}/` : remaining;
}

export function isProcessableEntry(fileName: string, stripCount: number): boolean {
  if (isMacOsMetadataEntry(fileName)) {
    return false;
  }
  return stripEntryName(fileName, stripCount) !== undefined;
}
