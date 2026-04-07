/**
 * E2E: all native tool IDs return valid SysIntResult shape through the dispatcher.
 * Tests shape validation only — not data correctness (system state varies on CI).
 * All 107 native tools from the catalog are exercised here.
 */

import { jest } from '@jest/globals';

// Mock nirsoft to avoid binary dependencies
jest.unstable_mockModule('../../nirsoft/index.js', () => ({
  default: {},
  isWSL: () => false,
  isSupported: () => false,
  loadCatalog: () => ({ tools: [] }),
  parseCsvToJson: () => [],
  createTempFile: async () => '',
}));

// All 107 native tool IDs from the catalog (Phase 0–5)
const ALL_NATIVE_TOOL_IDS = [
  // Phase 1: Process
  'process-list',
  'process-connections',
  'process-modules',
  'process-threads',
  'process-handles',
  'process-io',
  'process-tree',
  'service-list',
  // Phase 1: Network
  'cports',
  'network-interfaces',
  'dns-lookup',
  'wifi-scan',
  'wifi-history',
  'ping-test',
  'port-scan',
  'route-table',
  'arp-table',
  'mac-resolve',
  'whois-lookup',
  'traceroute',
  'http-headers',
  'network-stats',
  'wake-on-lan',
  'bandwidth-test',
  'connection-log',
  'ssl-checker',
  'bluetooth-scan',
  'network-shares',
  // Phase 2: Disk
  'disk-smart',
  'disk-partitions',
  'disk-space',
  'file-search',
  'duplicate-finder',
  'large-files',
  'recent-files',
  'disk-ads',
  'drive-map',
  'disk-io',
  'disk-freespace-log',
  'disk-links',
  'file-hash',
  'disk-recovery',
  // Phase 2: System
  'cpu-info',
  'memory-info',
  'os-info',
  'installed-apps',
  'update-history',
  'driver-list',
  'startup-programs',
  'scheduled-tasks',
  'event-log',
  'crash-analysis',
  'usb-history',
  'battery-info',
  'monitor-info',
  'login-history',
  'boot-history',
  'prefetch-info',
  'shell-extensions',
  'running-services',
  'security-software',
  'installed-packages',
  'environment-vars',
  'timezone-info',
  'hardware-info',
  'last-activity',
  'jump-lists',
  // Phase 3: Browser
  'browser-history',
  'browser-bookmarks',
  'browser-cookies',
  'browser-downloads',
  'browser-extensions',
  'browser-autofill',
  'browser-cache',
  'browser-search-history',
  'browser-profiles',
  'browser-forms',
  // Phase 4: Registry
  'registry-search',
  'registry-snapshot-diff',
  'registry-hive',
  'registry-startup',
  'registry-uninstall',
  'registry-usb',
  'registry-associations',
  'registry-mru',
  // Phase 4: Password
  'browser-chrome-passwords',
  'browser-firefox-passwords',
  'wifi-passwords',
  'credential-manager',
  'windows-vault',
  'rdp-credentials',
  'vnc-passwords',
  'mail-passwords',
  'lsa-secrets',
  'network-passwords',
  // Phase 5: Programmer
  'dll-exports',
  'pe-headers',
  'hash-batch',
  'dotnet-info',
  'resource-extract',
  'gac-viewer',
  // Phase 5: Outlook
  'outlook-attachments',
  'outlook-stats',
  'outlook-addressbook',
  // Phase 5: Audio
  'audio-devices',
  'audio-volume',
  'audio-codecs',
];

/**
 * Tools that need specific args to avoid long-running defaults.
 * Without args these tools either scan the entire filesystem or make
 * network connections that time out.
 */
const TOOL_ARGS: Record<string, string[]> = {
  // File system tools need a bounded directory
  'file-search': ['--pattern', 'nonexistent_e2e_test_file_xyz', '--dir', '/tmp'],
  'duplicate-finder': ['--dir', '/tmp', '--depth', '0'],
  'large-files': ['--dir', '/tmp', '--depth', '0'],
  'recent-files': ['--dir', '/tmp', '--depth', '0'],
  'disk-links': ['--dir', '/tmp', '--depth', '0'],
  'hash-batch': ['--dir', '/tmp', '--depth', '0', '--limit', '5'],
  // Network tools that make real connections — provide a quick-fail target
  'ping-test': ['127.0.0.1'],
  'dns-lookup': ['--host', 'localhost'],
  'whois-lookup': ['--domain', 'localhost'],
  'traceroute': ['--host', '127.0.0.1', '--maxHops', '1'],
  'ssl-checker': ['--host', 'localhost'],
  'bandwidth-test': ['--url', 'http://localhost'],
  // Outlook tools: need --file arg to fail fast without PowerShell timeout
  'outlook-attachments': ['--limit', '0'],
  'outlook-stats': [],
  'outlook-addressbook': ['--limit', '0'],
};

/**
 * Tools that require real Windows APIs on WSL and will timeout without Outlook.
 * Skip these on WSL CI (they're covered by unit tests with platform mocking).
 */
const WSL_SKIP_TOOLS = new Set([
  'outlook-attachments',
  'outlook-stats',
  'outlook-addressbook',
]);

/**
 * Tools that are inherently slow even with optimized args (network I/O).
 * These get an extended timeout.
 */
const SLOW_TOOLS = new Set([
  'ping-test',
  'traceroute',
  'bandwidth-test',
  'ssl-checker',
  'service-list',
]);

describe('E2E: all native tool IDs return valid SysIntResult shape', () => {
  let runTool: (toolId: string, args?: string[]) => Promise<unknown>;
  let resetDispatcher: () => void;

  const isWsl = process.platform === 'linux' && !!process.env['WSL_DISTRO_NAME'];

  beforeAll(async () => {
    jest.resetModules();
    const dispatcher = await import('../dispatcher.js');
    runTool = dispatcher.runTool;
    resetDispatcher = dispatcher.resetDispatcher;
  });

  afterAll(() => {
    resetDispatcher();
  });

  // Shape validator: SysIntResult must be either SysIntSuccess or SysIntError
  function assertValidShape(result: unknown, toolId: string): void {
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    expect(typeof result).toBe('object');

    const obj = result as Record<string, unknown>;

    // Must have 'tool' field matching the request
    expect(obj).toHaveProperty('tool', toolId);

    if ('error' in obj) {
      // SysIntError shape
      expect(typeof obj['error']).toBe('string');
      expect(typeof obj['code']).toBe('string');
      expect(['PLATFORM_UNSUPPORTED', 'PRIVILEGE_REQUIRED', 'NOT_FOUND', 'EXEC_FAILED']).toContain(obj['code']);
    } else {
      // SysIntSuccess shape
      expect(Array.isArray(obj['rows'])).toBe(true);
      expect(typeof obj['count']).toBe('number');
      expect(typeof obj['timestamp']).toBe('string');
      expect(typeof obj['platform']).toBe('string');
    }
  }

  // Run each tool with a 10s timeout per test
  for (const toolId of ALL_NATIVE_TOOL_IDS) {
    if (isWsl && WSL_SKIP_TOOLS.has(toolId)) {
      it.skip(`${toolId} returns valid SysIntResult shape (skipped on WSL — covered by unit tests)`, () => {});
      continue;
    }

    const args = TOOL_ARGS[toolId] ?? [];
    const timeout = SLOW_TOOLS.has(toolId) ? 20000 : 10000;
    it(`${toolId} returns valid SysIntResult shape`, async () => {
      const result = await runTool(toolId, args);
      assertValidShape(result, toolId);
    }, timeout);
  }
});

describe('E2E: unknown tool ID returns NOT_FOUND', () => {
  let runTool: (toolId: string) => Promise<unknown>;

  beforeAll(async () => {
    jest.resetModules();
    const dispatcher = await import('../dispatcher.js');
    runTool = dispatcher.runTool;
  });

  it('returns NOT_FOUND for completely unknown tool', async () => {
    const result = await runTool('completely-unknown-tool-xyz-123') as Record<string, unknown>;
    expect(result).toMatchObject({ code: 'NOT_FOUND', tool: 'completely-unknown-tool-xyz-123' });
  });
});

describe('Catalog completeness', () => {
  let getCatalog: () => { tools: Array<{ id: string }> };

  beforeAll(async () => {
    const loaderMod = await import('../catalog/loader.js');
    getCatalog = loaderMod.getCatalog;
  });

  it('catalog contains all 107 native tool IDs', () => {
    const catalog = getCatalog();
    const catalogIds = catalog.tools.map((t) => t.id);
    for (const id of ALL_NATIVE_TOOL_IDS) {
      expect(catalogIds).toContain(id);
    }
  });

  it('all catalog tools have required fields', () => {
    const catalog = getCatalog();
    for (const tool of catalog.tools) {
      expect(typeof tool.id).toBe('string');
      expect(tool.id.length).toBeGreaterThan(0);
      expect(typeof (tool as Record<string, unknown>)['name']).toBe('string');
      expect(typeof (tool as Record<string, unknown>)['category']).toBe('string');
    }
  });
});
