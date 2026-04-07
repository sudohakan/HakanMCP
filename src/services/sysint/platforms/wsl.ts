import { AbstractSysIntPlatform } from './abstract.js';

/** WSL environment — Linux subsystem with access to Windows-side tools via PowerShell. */
export class WSLPlatform extends AbstractSysIntPlatform {
  readonly name = 'wsl' as const;
}
