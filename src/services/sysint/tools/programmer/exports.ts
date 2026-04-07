/**
 * PRG-01: dll-exports — List exported symbols from DLL (Windows) or shared object (Linux).
 * Windows/WSL: dumpbin.exe /exports or PowerShell reflection
 * Linux: nm -D <file> or readelf -Ws <file>
 */
import { buildSuccess, buildError, getPlatformName, execCmd, execPs, parseArg, isWsl } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface ExportRow {
  ordinal: number | null;
  address: string;
  symbol: string;
  type: 'function' | 'data' | 'unknown';
}

// ── Parser: nm -D output ──────────────────────────────────────────────────────

/**
 * Parse `nm -D` output.
 * Format: [addr] [type] [name]
 * Example: 0000000000001234 T my_function
 *          (no address)     U external_symbol
 */
export function parseNmOutput(output: string): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // nm -D format: optional address, type char, symbol name
    const match = trimmed.match(/^([0-9a-fA-F]+)?\s+([A-Za-z])\s+(\S+)$/);
    if (!match) continue;
    const [, addr, typeChar, name] = match;
    // Only exported (uppercase type) symbols
    if (!typeChar || typeChar !== typeChar.toUpperCase()) continue;
    // Skip undefined (U) — those are imports
    if (typeChar === 'U') continue;
    const type: ExportRow['type'] = typeChar === 'T' || typeChar === 'W' ? 'function'
      : typeChar === 'D' || typeChar === 'B' || typeChar === 'R' ? 'data'
      : 'unknown';
    rows.push({
      ordinal: null,
      address: addr ?? '',
      symbol: name ?? '',
      type,
    });
  }
  return rows;
}

// ── Parser: dumpbin /exports output ──────────────────────────────────────────

/**
 * Parse `dumpbin /exports` output.
 * Exports table section looks like:
 *   ordinal hint RVA      name
 *       1    0  00011234  MyFunction
 */
export function parseDumpbinOutput(output: string): ExportRow[] {
  const rows: ExportRow[] = [];
  let inTable = false;
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ordinal') && trimmed.includes('hint') && trimmed.includes('name')) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (trimmed.startsWith('Summary')) {
      inTable = false;
      continue;
    }
    // Skip blank lines within the table
    if (!trimmed) continue;
    // Format: ordinal  hint  RVA  name (whitespace separated)
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const ordinal = parseInt(parts[0] ?? '', 10);
    const address = parts[2] ?? '';
    const name = parts[3] ?? '';
    if (!name || isNaN(ordinal)) continue;
    rows.push({ ordinal, address, symbol: name, type: 'function' });
  }
  return rows;
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function runDllExports(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const filePath = parseArg(args, '--file');
  if (!filePath) {
    return buildError('dll-exports requires --file <path>', 'EXEC_FAILED', 'dll-exports');
  }

  try {
    if (process.platform === 'linux' && !isWsl()) {
      // Linux: use nm -D
      const { stdout } = await execCmd(`nm -D "${filePath}"`, 20000);
      const rows = parseNmOutput(stdout);
      return buildSuccess(rows, 'dll-exports', platform);
    } else {
      // Windows or WSL: try dumpbin first, fallback to readelf via wsl
      try {
        const { stdout } = await execCmd(`dumpbin /exports "${filePath}"`, 15000);
        const rows = parseDumpbinOutput(stdout);
        return buildSuccess(rows, 'dll-exports', platform);
      } catch {
        // dumpbin not available — try PowerShell reflection
        const script = `
try {
  $a = [System.Reflection.Assembly]::LoadFile('${filePath.replace(/'/g, "''")}')
  $a.GetExportedTypes() | ForEach-Object { $_.FullName }
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
`.trim();
        const { stdout } = await execPs(script, 15000);
        if (stdout.startsWith('ERROR:')) {
          return buildError(`dll-exports failed: ${stdout}`, 'EXEC_FAILED', 'dll-exports');
        }
        const rows = stdout.split('\n')
          .filter(Boolean)
          .map((name) => ({ ordinal: null, address: '', symbol: name.trim(), type: 'unknown' as const }));
        return buildSuccess(rows, 'dll-exports', platform);
      }
    }
  } catch (err) {
    return buildError(`dll-exports failed: ${String(err)}`, 'EXEC_FAILED', 'dll-exports');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'dll-exports') return runDllExports(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
