export interface ZipEntry {
  fileName: string;
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
  compressionMethod: number;
  generalPurposeBitFlag: number;
  lastModFileTime: number;
  lastModFileDate: number;
  externalFileAttributes: number;
  versionMadeBy: number;
  relativeOffsetOfLocalHeader: number;
}

export interface ZipHandle {
  entryCount: number;
  isOpen: boolean;
  close(): void;
}

export interface Options {
  dir: string;
  defaultDirMode?: number;
  defaultFileMode?: number;
  onEntry?: (entry: ZipEntry, zipfile: ZipHandle) => void;
  strip?: number;
  noOverwrite?: boolean;
}
