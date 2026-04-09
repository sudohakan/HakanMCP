/**
 * SysInt catalog type definitions.
 */

export interface SysIntTool {
  id: string;
  name: string;
  description: string;
  category: string;
  adminRequired: boolean;
  timeout: number;
  /** true when a native TypeScript implementation is available */
  native: boolean;
  /** Platforms this tool supports. WSL tools that need Windows-side execution use ['win32', 'wsl']. */
  platforms: ('win32' | 'linux' | 'wsl')[];
}

export interface SysIntCatalog {
  version: number;
  categories: string[];
  tools: SysIntTool[];
}
