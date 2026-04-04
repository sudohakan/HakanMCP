import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DriveInfo } from '../../../types/disk.js';
import { AbstractDiskPlatform } from './base.js';

const execFileAsync = promisify(execFile);

function escapePsString(s: string): string {
  return s.replace(/'/g, "''");
}

function runPs(command: string, maxBuffer?: number): Promise<{ stdout: string }> {
  return execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    maxBuffer: maxBuffer ?? 5 * 1024 * 1024,
  });
}

export class WindowsPlatform extends AbstractDiskPlatform {
  async getDrives(): Promise<DriveInfo[]> {
    const { stdout } = await runPs(
      'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free,Root,Description | ConvertTo-Json',
      10 * 1024 * 1024,
    );
    const raw = JSON.parse(stdout);
    const drives = Array.isArray(raw) ? raw : [raw];
    return drives.map((d: Record<string, unknown>) => ({
      name: String(d.Name),
      label: String(d.Description ?? ''),
      mountpoint: String(d.Root),
      filesystem: 'NTFS',
      totalBytes: (Number(d.Used) || 0) + (Number(d.Free) || 0),
      usedBytes: Number(d.Used) || 0,
      freeBytes: Number(d.Free) || 0,
      usedPercent: ((Number(d.Used) || 0) / ((Number(d.Used) || 0) + (Number(d.Free) || 1))) * 100,
      isRemovable: false,
    }));
  }

  async getDirectorySize(dirPath: string): Promise<number> {
    const escaped = escapePsString(dirPath.replace(/\//g, '\\'));
    const { stdout } = await runPs(
      `(Get-ChildItem -LiteralPath '${escaped}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`,
      10 * 1024 * 1024,
    );
    return Number(stdout.trim()) || 0;
  }

  async getRecycleBinSize(): Promise<number> {
    const { stdout } = await runPs(
      '(New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $_.Size } | Measure-Object -Sum | Select-Object -ExpandProperty Sum',
    );
    return Number(stdout.trim()) || 0;
  }

  async emptyRecycleBin(): Promise<void> {
    await runPs('Clear-RecycleBin -Force');
  }

  async sendToRecycleBin(filePath: string): Promise<void> {
    const escaped = escapePsString(filePath.replace(/\//g, '\\'));
    await runPs(
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
    );
  }

  async compress(sourcePath: string, format: string, destPath: string): Promise<string> {
    const ext = format === '7z' ? '7z' : 'zip';
    const outPath = destPath.endsWith(`.${ext}`) ? destPath : `${destPath}.${ext}`;
    if (format === '7z') {
      await execFileAsync('7z', ['a', outPath, sourcePath, '-mx=5']);
    } else {
      const escaped_src = escapePsString(sourcePath.replace(/\//g, '\\'));
      const escaped_dst = escapePsString(outPath.replace(/\//g, '\\'));
      await runPs(`Compress-Archive -LiteralPath '${escaped_src}' -DestinationPath '${escaped_dst}' -Force`);
    }
    return outPath;
  }

  async decompress(archivePath: string, destPath: string): Promise<void> {
    if (archivePath.endsWith('.7z')) {
      await execFileAsync('7z', ['x', archivePath, `-o${destPath}`, '-y']);
    } else {
      const escaped_src = escapePsString(archivePath);
      const escaped_dst = escapePsString(destPath);
      await runPs(`Expand-Archive -LiteralPath '${escaped_src}' -DestinationPath '${escaped_dst}' -Force`);
    }
  }
}
