/**
 * Network interfaces and statistics tools — NET-02, NET-14
 */
import si from 'systeminformation';
import { buildSuccess, buildError } from './shared.js';
import { getPlatformName } from './shared.js';
import type { SysIntResult } from './shared.js';

export interface InterfaceRow {
  name: string;
  ip4: string;
  ip6: string;
  mac: string;
  speedMbps: number;
  status: string;
  type: string;
  default: boolean;
}

export interface NetworkStatsRow {
  interface: string;
  rxBytes: number;
  txBytes: number;
  rxDropped: number;
  txDropped: number;
}

async function runNetworkInterfaces(): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const ifaces = await si.networkInterfaces();
    const list = Array.isArray(ifaces) ? ifaces : [ifaces];
    const rows: InterfaceRow[] = list.map((i) => ({
      name: i.iface,
      ip4: i.ip4 ?? '',
      ip6: i.ip6 ?? '',
      mac: i.mac ?? '',
      speedMbps: i.speed ?? 0,
      status: i.operstate ?? '',
      type: i.type ?? '',
      default: (i as unknown as Record<string, unknown>)['default'] as boolean ?? false,
    }));
    return buildSuccess(rows, 'network-interfaces', platform);
  } catch (err) {
    return buildError(`network-interfaces failed: ${String(err)}`, 'EXEC_FAILED', 'network-interfaces');
  }
}

async function runNetworkStats(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const iface = args[0] ?? '*';
  try {
    const stats = await si.networkStats(iface);
    const rows: NetworkStatsRow[] = stats.map((s) => ({
      interface: s.iface,
      rxBytes: s.rx_bytes ?? 0,
      txBytes: s.tx_bytes ?? 0,
      rxDropped: s.rx_dropped ?? 0,
      txDropped: s.tx_dropped ?? 0,
    }));
    return buildSuccess(rows, 'network-stats', platform);
  } catch (err) {
    return buildError(`network-stats failed: ${String(err)}`, 'EXEC_FAILED', 'network-stats');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  switch (toolId) {
    case 'network-interfaces': return runNetworkInterfaces();
    case 'network-stats': return runNetworkStats(args);
    default: return buildError(`Unknown interfaces tool: ${toolId}`, 'EXEC_FAILED', toolId);
  }
}
