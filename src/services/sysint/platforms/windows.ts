import { AbstractSysIntPlatform } from './abstract.js';

export class WindowsPlatform extends AbstractSysIntPlatform {
  readonly name = 'win32' as const;
}
