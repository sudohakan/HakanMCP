/**
 * Abstract platform adapter — defines the interface all platform implementations must satisfy.
 * Phase 0 only establishes the contract; tool-specific methods are added in Phase 1+ as
 * category implementations land.
 */
export abstract class AbstractSysIntPlatform {
  abstract readonly name: 'win32' | 'linux' | 'wsl';
}
