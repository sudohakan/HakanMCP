/**
 * PRG-06: gac-viewer — List assemblies in Global Assembly Cache.
 * Windows: scan %WINDIR%\assembly and %WINDIR%\Microsoft.NET\assembly
 * Linux: scan /usr/lib/mono/gac or ~/.config/mono/gac (Mono GAC)
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildSuccess, buildError, getPlatformName, execPs } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface GACRow {
  name: string;
  version: string;
  publicKeyToken: string;
  path: string;
  runtime: string;
}

// ── Linux: Mono GAC ───────────────────────────────────────────────────────────

async function listMonoGac(gacDir: string, runtime: string): Promise<GACRow[]> {
  const rows: GACRow[] = [];
  try {
    const assemblies = await readdir(gacDir, { withFileTypes: true });
    for (const asmEntry of assemblies) {
      if (!asmEntry.isDirectory()) continue;
      const asmDir = path.join(gacDir, asmEntry.name);
      try {
        const versions = await readdir(asmDir, { withFileTypes: true });
        for (const verEntry of versions) {
          if (!verEntry.isDirectory()) continue;
          // Mono GAC format: version__publicKeyToken
          const parts = verEntry.name.split('__');
          const version = parts[0] ?? '';
          const pkt = parts[1] ?? '';
          const dllPath = path.join(asmDir, verEntry.name, `${asmEntry.name}.dll`);
          rows.push({
            name: asmEntry.name,
            version,
            publicKeyToken: pkt,
            path: dllPath,
            runtime,
          });
        }
      } catch {
        // Skip unreadable assembly dirs
      }
    }
  } catch {
    // GAC dir not accessible
  }
  return rows;
}

// ── Windows: .NET GAC via PowerShell ─────────────────────────────────────────

async function listWindowsGac(): Promise<GACRow[]> {
  const script = `
$gacPaths = @(
  "$env:WINDIR\\assembly",
  "$env:WINDIR\\Microsoft.NET\\assembly\\GAC_32",
  "$env:WINDIR\\Microsoft.NET\\assembly\\GAC_64",
  "$env:WINDIR\\Microsoft.NET\\assembly\\GAC_MSIL"
)
foreach ($gacPath in $gacPaths) {
  if (-not (Test-Path $gacPath)) { continue }
  Get-ChildItem -Path $gacPath -Recurse -Filter "*.dll" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $parts = $_.DirectoryName.Split([System.IO.Path]::DirectorySeparatorChar)
      $version = ''
      $pkt = ''
      if ($parts.Length -ge 2) {
        $versionPart = $parts[$parts.Length - 1]
        $split = $versionPart.Split('__')
        $version = $split[0]
        $pkt = if ($split.Length -gt 1) { $split[1] } else { '' }
      }
      $name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
      "$name\t$version\t$pkt\t$($_.FullName)\tv4"
    }
}
`.trim();

  const rows: GACRow[] = [];
  try {
    const { stdout } = await execPs(script, 20000);
    for (const line of stdout.split('\n')) {
      const parts = line.trim().split('\t');
      if (parts.length < 4) continue;
      const [name, version, pkt, filePath, runtime] = parts;
      if (!name) continue;
      rows.push({
        name: (name ?? '').trim(),
        version: (version ?? '').trim(),
        publicKeyToken: (pkt ?? '').trim(),
        path: (filePath ?? '').trim(),
        runtime: (runtime ?? 'v4').trim(),
      });
    }
  } catch {
    // PowerShell unavailable
  }
  return rows;
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function runGacViewer(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();

  if (process.platform === 'linux' && !process.env['WSL_DISTRO_NAME']) {
    // Linux: check Mono GAC locations
    const monoGacDirs = [
      '/usr/lib/mono/gac',
      '/usr/share/mono/gac',
      `${process.env['HOME'] ?? '/root'}/.config/mono/gac`,
    ];

    const rows: GACRow[] = [];
    for (const dir of monoGacDirs) {
      try {
        await stat(dir);
        const found = await listMonoGac(dir, 'mono');
        rows.push(...found);
      } catch {
        // Not found, skip
      }
    }

    if (rows.length === 0) {
      return buildSuccess(
        [{ note: 'No Mono GAC found. Install mono-runtime to populate /usr/lib/mono/gac' }],
        'gac-viewer',
        platform,
      );
    }
    return buildSuccess(rows, 'gac-viewer', platform);
  }

  // Windows or WSL
  const rows = await listWindowsGac();
  return buildSuccess(rows, 'gac-viewer', platform);
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'gac-viewer') return runGacViewer(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
