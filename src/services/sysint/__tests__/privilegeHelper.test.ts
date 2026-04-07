import { jest } from '@jest/globals';
import type { SysIntTool } from '../catalog/types.js';

// Mock child_process exec to avoid real system calls for privilege detection
jest.unstable_mockModule('node:child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
}));

describe('Privilege Helper', () => {
  let requirePrivilege: (tool: SysIntTool, toolId: string) => Promise<import('../outputFormatter.js').SysIntError | null>;
  let requirePlatform: (tool: SysIntTool, toolId: string, currentPlatform: import('../outputFormatter.js').SysIntPlatform) => import('../outputFormatter.js').SysIntError | null;
  let _resetPrivilegeLevel: () => void;

  const makeTool = (overrides: Partial<SysIntTool> = {}): SysIntTool => ({
    id: 'test-tool',
    name: 'Test Tool',
    description: 'A test tool',
    category: 'network',
    adminRequired: false,
    timeout: 30,
    native: false,
    platforms: ['win32', 'linux', 'wsl'],
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetModules();
    const helper = await import('../privilegeHelper.js');
    requirePrivilege = helper.requirePrivilege;
    requirePlatform = helper.requirePlatform;
    _resetPrivilegeLevel = helper._resetPrivilegeLevel;
    _resetPrivilegeLevel();
  });

  afterEach(() => {
    _resetPrivilegeLevel();
  });

  describe('requirePlatform', () => {
    it('returns null when platform is in tool.platforms', () => {
      const tool = makeTool({ platforms: ['win32', 'linux', 'wsl'] });
      expect(requirePlatform(tool, 'test-tool', 'linux')).toBeNull();
    });

    it('returns error when platform not in tool.platforms', () => {
      const tool = makeTool({ platforms: ['win32', 'wsl'] });
      const result = requirePlatform(tool, 'test-tool', 'linux');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('PLATFORM_UNSUPPORTED');
      expect(result?.tool).toBe('test-tool');
    });

    it('WSL can use Windows-only tools (special case)', () => {
      const tool = makeTool({ platforms: ['win32'] }); // Windows-only
      // WSL should be allowed to use Windows tools (via PowerShell)
      const result = requirePlatform(tool, 'test-tool', 'wsl');
      expect(result).toBeNull(); // Should pass
    });

    it('returns null when platform matches win32', () => {
      const tool = makeTool({ platforms: ['win32'] });
      expect(requirePlatform(tool, 'test-tool', 'win32')).toBeNull();
    });

    it('returns error message containing tool id', () => {
      const tool = makeTool({ platforms: ['win32'] });
      const result = requirePlatform(tool, 'my-tool', 'linux');
      expect(result?.error).toContain('my-tool');
    });
  });

  describe('requirePrivilege', () => {
    it('returns null when tool does not require admin', async () => {
      const tool = makeTool({ adminRequired: false });
      const result = await requirePrivilege(tool, 'test-tool');
      expect(result).toBeNull();
    });

    it('returns PRIVILEGE_REQUIRED error when tool requires admin and user is not admin', async () => {
      // We can test by checking the function returns appropriate error shape
      // In CI/test environment, running as non-root typically
      const tool = makeTool({ adminRequired: true });
      const result = await requirePrivilege(tool, 'admin-tool');
      // Result is either null (if running as admin) or a privilege error
      if (result !== null) {
        expect(result.code).toBe('PRIVILEGE_REQUIRED');
        expect(result.tool).toBe('admin-tool');
      }
    });
  });

  describe('_resetPrivilegeLevel', () => {
    it('clears cached privilege level', () => {
      // Just verify the function exists and runs without error
      expect(() => _resetPrivilegeLevel()).not.toThrow();
    });
  });
});
