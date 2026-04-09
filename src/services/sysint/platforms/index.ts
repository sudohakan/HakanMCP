import { isWSL } from '../pathHelper.js';
import { AbstractSysIntPlatform } from './abstract.js';
import { WindowsPlatform } from './windows.js';
import { LinuxPlatform } from './linux.js';
import { WSLPlatform } from './wsl.js';

export type { AbstractSysIntPlatform };
export { WindowsPlatform, LinuxPlatform, WSLPlatform };

let _platform: AbstractSysIntPlatform | null = null;

function detectPlatform(): AbstractSysIntPlatform {
  if (process.platform === 'win32') {
    return new WindowsPlatform();
  }
  if (isWSL()) {
    return new WSLPlatform();
  }
  return new LinuxPlatform();
}

export function getPlatform(): AbstractSysIntPlatform {
  if (_platform) return _platform;
  _platform = detectPlatform();
  return _platform;
}

/** Reset singleton for test isolation. */
export function _resetPlatform(): void {
  _platform = null;
}

export function getPlatformName(): 'win32' | 'linux' | 'wsl' {
  return getPlatform().name;
}
