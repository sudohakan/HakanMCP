import { LinuxPlatform } from './linux.js';

/** WSL environment — extends LinuxPlatform since WSL runs as Linux. */
export class WSLPlatform extends LinuxPlatform {
  override readonly name = 'wsl' as const;
}
