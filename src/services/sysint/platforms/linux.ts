import { AbstractSysIntPlatform } from './abstract.js';

export class LinuxPlatform extends AbstractSysIntPlatform {
  readonly name = 'linux' as const;
}
