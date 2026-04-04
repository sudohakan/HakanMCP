import { WindowsPlatform } from './windows.js';
import { LinuxPlatform } from './linux.js';
import type { DiskPlatform } from './types.js';

export type { DiskPlatform } from './types.js';

let cachedPlatform: DiskPlatform | null = null;

export function getPlatform(): DiskPlatform {
  if (cachedPlatform) return cachedPlatform;
  cachedPlatform = process.platform === 'win32' ? new WindowsPlatform() : new LinuxPlatform();
  return cachedPlatform;
}

export function setPlatform(platform: DiskPlatform): void {
  cachedPlatform = platform;
}
