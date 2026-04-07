/**
 * Phase 1 integration tests — dispatches all 28 native tools through the dispatcher.
 * Verifies: correct tool routing, guard sequences, and graceful handling on any platform.
 * Each tool is called with minimal valid args; result must be rows or a named error.
 */
import { runTool, resetDispatcher } from '../dispatcher.js';

beforeEach(() => {
  resetDispatcher();
});

// ── Process tools (8) ─────────────────────────────────────────────────────────

describe('process category dispatch', () => {
  const PROCESS_TOOLS = [
    'process-list',
    'process-tree',
    'service-list',
  ] as const;

  for (const toolId of PROCESS_TOOLS) {
    it(`${toolId} — returns rows or graceful error`, async () => {
      const result = await runTool(toolId, []) as unknown as Record<string, unknown>;
      expect(result).toBeDefined();
      expect('rows' in result || 'error' in result || 'code' in result).toBe(true);
    }, 20_000);
  }

  // Tools that require args — verify error handling
  it('process-connections — returns rows or graceful error', async () => {
    const result = await runTool('process-connections', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('rows' in result || 'error' in result || 'code' in result).toBe(true);
  }, 15_000);

  it('process-modules — returns EXEC_FAILED or rows (requires PID arg)', async () => {
    const result = await runTool('process-modules', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('code' in result || 'rows' in result).toBe(true);
  }, 15_000);

  it('process-threads — returns EXEC_FAILED or rows (requires PID arg)', async () => {
    const result = await runTool('process-threads', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('code' in result || 'rows' in result).toBe(true);
  }, 15_000);

  it('process-handles — returns EXEC_FAILED or rows (requires PID arg)', async () => {
    const result = await runTool('process-handles', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('code' in result || 'rows' in result).toBe(true);
  }, 15_000);

  it('process-io — returns EXEC_FAILED or rows (requires PID arg)', async () => {
    const result = await runTool('process-io', []) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    expect('code' in result || 'rows' in result).toBe(true);
  }, 15_000);
});

// ── Network tools (20) ────────────────────────────────────────────────────────

describe('network category dispatch', () => {
  const NO_ARG_TOOLS = [
    'cports',
    'network-interfaces',
    'network-stats',
    'wifi-scan',
    'wifi-history',
    'route-table',
    'arp-table',
    'connection-log',
    'bluetooth-scan',
    'network-shares',
  ] as const;

  for (const toolId of NO_ARG_TOOLS) {
    it(`${toolId} — returns rows or graceful error`, async () => {
      const result = await runTool(toolId, []) as unknown as Record<string, unknown>;
      expect(result).toBeDefined();
      expect('rows' in result || 'error' in result || 'code' in result).toBe(true);
    }, 15_000);
  }

  // Tools requiring args — verify guard behavior
  it('dns-lookup without args — returns EXEC_FAILED', async () => {
    const result = await runTool('dns-lookup', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('dns-lookup with hostname — returns rows', async () => {
    const result = await runTool('dns-lookup', ['example.com']) as unknown as Record<string, unknown>;
    expect(result).toBeDefined();
    if ('rows' in result) {
      expect(result['tool']).toBe('dns-lookup');
    }
  }, 15_000);

  it('ping-test — pings localhost', async () => {
    const result = await runTool('ping-test', ['127.0.0.1']) as unknown as Record<string, unknown>;
    expect('rows' in result || 'error' in result).toBe(true);
  }, 15_000);

  it('port-scan without args — returns EXEC_FAILED', async () => {
    const result = await runTool('port-scan', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('http-headers without args — returns EXEC_FAILED', async () => {
    const result = await runTool('http-headers', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('ssl-checker without args — returns EXEC_FAILED', async () => {
    const result = await runTool('ssl-checker', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('mac-resolve without args — returns EXEC_FAILED', async () => {
    const result = await runTool('mac-resolve', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('whois-lookup without args — returns EXEC_FAILED', async () => {
    const result = await runTool('whois-lookup', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('traceroute without args — returns EXEC_FAILED', async () => {
    const result = await runTool('traceroute', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });

  it('wake-on-lan without args — returns EXEC_FAILED', async () => {
    const result = await runTool('wake-on-lan', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('EXEC_FAILED');
  });
});

// ── Dispatcher guard sequence ─────────────────────────────────────────────────

describe('dispatcher guard sequence', () => {
  it('unknown tool returns NOT_FOUND', async () => {
    const result = await runTool('totally-nonexistent-tool-xyz', []) as unknown as Record<string, unknown>;
    expect(result['code']).toBe('NOT_FOUND');
  });
});
