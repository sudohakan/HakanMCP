import type { DriveInfo, ScanEntry } from '../../../types/disk.js';

export interface DiskPlatform {
  getDrives(): Promise<DriveInfo[]>;
  getDirectorySize(dirPath: string): Promise<number>;
  getDirectoryEntries(dirPath: string, depth: number, minSize: number): Promise<ScanEntry[]>;
  deleteFile(filePath: string): Promise<void>;
  deleteDirRecursive(dirPath: string): Promise<void>;
  moveItem(source: string, destination: string): Promise<void>;
  getRecycleBinSize(): Promise<number>;
  emptyRecycleBin(): Promise<void>;
  sendToRecycleBin(filePath: string): Promise<void>;
  compress(sourcePath: string, format: string, destPath: string): Promise<string>;
  decompress(archivePath: string, destPath: string): Promise<void>;
  getFileHash(filePath: string, algorithm: string): Promise<string>;
}
