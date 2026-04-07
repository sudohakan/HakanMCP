/**
 * Phase 2 integration test — verifies all 39 tools reachable via dispatcher.
 * Each tool must return SysIntResult shape. Acceptable: rows array OR error code.
 * Not acceptable: undefined, null, throw.
 */
let runTool: (toolId: string, args?: string[]) => Promise<unknown>;

beforeAll(async () => {
  const mod = await import('../dispatcher.js');
  runTool = mod.runTool;
});

const ALL_DISK_TOOLS = [
  'disk-smart', 'disk-partitions', 'disk-space', 'file-search', 'duplicate-finder',
  'large-files', 'recent-files', 'disk-ads', 'drive-map', 'disk-io',
  'disk-freespace-log', 'disk-links', 'file-hash', 'disk-recovery',
];

const ALL_SYSTEM_TOOLS = [
  'cpu-info', 'memory-info', 'os-info', 'installed-apps', 'update-history',
  'driver-list', 'startup-programs', 'scheduled-tasks', 'event-log', 'crash-analysis',
  'usb-history', 'battery-info', 'monitor-info', 'login-history', 'boot-history',
  'prefetch-info', 'shell-extensions', 'running-services', 'security-software',
  'installed-packages', 'environment-vars', 'timezone-info', 'hardware-info',
  'last-activity', 'jump-lists',
];

function getArgs(toolId: string): string[] {
  switch (toolId) {
    case 'file-hash': return ['src/services/sysint/outputFormatter.ts'];
    case 'file-search': return ['src/services/sysint', '*.ts', '1'];
    case 'duplicate-finder': return ['src/services/sysint/tools/disk', '0'];
    case 'large-files': return ['.', '5', '1024'];
    case 'recent-files': return ['.', '5'];
    case 'disk-links': return ['.', '1'];
    case 'event-log': return ['all', '', '1', '5'];
    default: return [];
  }
}

describe('Phase 2 disk tools — dispatcher reachability', () => {
  for (const toolId of ALL_DISK_TOOLS) {
    it(`${toolId} returns SysIntResult (not crash)`, async () => {
      const result = await runTool(toolId, getArgs(toolId)) as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      const isSuccess = 'rows' in result && 'count' in result && 'tool' in result;
      const isError = 'error' in result && 'code' in result;
      expect(isSuccess || isError).toBe(true);
    }, 120_000);
  }
});

describe('Phase 2 system tools — dispatcher reachability', () => {
  for (const toolId of ALL_SYSTEM_TOOLS) {
    it(`${toolId} returns SysIntResult (not crash)`, async () => {
      const result = await runTool(toolId, getArgs(toolId)) as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      const isSuccess = 'rows' in result && 'count' in result && 'tool' in result;
      const isError = 'error' in result && 'code' in result;
      expect(isSuccess || isError).toBe(true);
    }, 120_000);
  }
});

// ── Specific behavior tests ──────────────────────────────────────────────────

describe('Phase 2 specific behaviors', () => {
  it('disk-ads on pure Linux (not WSL) returns PLATFORM_UNSUPPORTED', async () => {
    const { getPlatformName } = await import('../platforms/index.js');
    if (getPlatformName() === 'linux') {
      const result = await runTool('disk-ads') as Record<string, unknown>;
      expect(result['code']).toBe('PLATFORM_UNSUPPORTED');
    }
  });

  it('jump-lists on pure Linux (not WSL) returns PLATFORM_UNSUPPORTED', async () => {
    const { getPlatformName } = await import('../platforms/index.js');
    if (getPlatformName() === 'linux') {
      const result = await runTool('jump-lists') as Record<string, unknown>;
      expect(result['code']).toBe('PLATFORM_UNSUPPORTED');
    }
  });

  it('file-hash of known file returns valid sha256', async () => {
    const result = await runTool('file-hash', ['src/services/sysint/outputFormatter.ts']) as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(String(rows[0]['hash'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cpu-info rows[0].cores > 0', async () => {
    const result = await runTool('cpu-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(Number(rows[0]['cores'])).toBeGreaterThan(0);
  });

  it('memory-info rows[0].totalBytes > 0', async () => {
    const result = await runTool('memory-info') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    expect(Number(rows[0]['totalBytes'])).toBeGreaterThan(0);
  });

  it('environment-vars returns PATH', async () => {
    const result = await runTool('environment-vars') as Record<string, unknown>;
    expect('rows' in result).toBe(true);
    const rows = result['rows'] as Array<Record<string, unknown>>;
    const pathRow = rows.find((r) => r['name'] === 'PATH' || r['name'] === 'Path');
    expect(pathRow).toBeDefined();
  });

  it('catalog has 39 Phase 2 tools', async () => {
    const { getCatalog } = await import('../catalog/loader.js');
    const catalog = getCatalog();
    const phase2Ids = new Set([...ALL_DISK_TOOLS, ...ALL_SYSTEM_TOOLS]);
    const found = catalog.tools.filter((t) => phase2Ids.has(t.id));
    expect(found.length).toBe(39);
    // All should be native
    const native = found.filter((t) => t.native);
    expect(native.length).toBe(39);
  });
});
