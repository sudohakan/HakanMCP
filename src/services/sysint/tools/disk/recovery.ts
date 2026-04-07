/**
 * DSK-14: disk-recovery — Deleted file recovery metadata.
 * Windows: VSS shadow copy info via vssadmin.
 * Linux: extundelete / journal recovery info.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSuccess, buildError, getPlatformName } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

const execAsync = promisify(exec);

export interface ShadowCopyRow {
  id: string;
  createdAt: string;
  volumeName: string;
  originatingMachine: string;
  forVolume: string;
}

export interface LinuxRecoveryRow {
  filesystem: string;
  journalPresent: boolean;
  recoveryTool: string;
  notes: string;
}

export function parseShadowCopies(output: string): ShadowCopyRow[] {
  const rows: ShadowCopyRow[] = [];
  const normalized = output.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\s*\n/).filter((b) => b.includes('Shadow Copy ID'));

  for (const block of blocks) {
    const getId = (label: string): string => {
      const match = block.match(new RegExp(`${label}:\\s*(.+)`));
      return match ? match[1].trim() : '';
    };

    const id = getId('Shadow Copy ID');
    if (!id) continue;

    rows.push({
      id: id.replace(/[{}]/g, ''),
      createdAt: getId('Creation Time'),
      volumeName: getId('Volume Name').split('Volume Name:').pop()?.trim() ?? '',
      originatingMachine: getId('Originating Machine'),
      forVolume: getId('Shadow Copy Volume').split('\\\\?\\').pop()?.trim() ?? '',
    });
  }
  return rows;
}

async function runRecoveryWindows(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const [drive = 'C:'] = args;
  try {
    const { stdout } = await execAsync(`vssadmin list shadows /For=${drive} 2>&1`, { timeout: 30_000 });
    const rows = parseShadowCopies(stdout);
    return buildSuccess(rows, 'disk-recovery', platform);
  } catch (err) {
    return buildError(`disk-recovery failed: ${String(err)}`, 'EXEC_FAILED', 'disk-recovery');
  }
}

async function runRecoveryLinux(): Promise<SysIntResult> {
  const platform = getPlatformName();
  const rows: LinuxRecoveryRow[] = [];

  // Check for extundelete
  try {
    await execAsync('which extundelete 2>/dev/null', { timeout: 5000 });
    rows.push({
      filesystem: 'ext2/3/4',
      journalPresent: true,
      recoveryTool: 'extundelete',
      notes: 'extundelete is available. Use: extundelete --restore-all <device>',
    });
  } catch {
    rows.push({
      filesystem: 'ext2/3/4',
      journalPresent: false,
      recoveryTool: 'testdisk/photorec',
      notes: 'extundelete not found. Consider testdisk or photorec for recovery.',
    });
  }

  // Check for foremost
  try {
    await execAsync('which foremost 2>/dev/null', { timeout: 5000 });
    rows.push({
      filesystem: 'any',
      journalPresent: false,
      recoveryTool: 'foremost',
      notes: 'foremost is available for carving-based recovery.',
    });
  } catch {
    // not available
  }

  return buildSuccess(rows, 'disk-recovery', platform);
}

export async function run(_toolId: string, args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  if (platform === 'win32' || platform === 'wsl') {
    return runRecoveryWindows(args);
  }
  return runRecoveryLinux();
}
