/**
 * PRG-04: dotnet-info — Read .NET assembly metadata.
 * Windows/WSL: PowerShell reflection. Linux: monodis if available, else stub.
 */
import { buildSuccess, buildError, getPlatformName, execCmd, execPs, parseArg, assertWindowsOrWsl } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface DotNetInfoRow {
  name: string;
  version: string;
  culture: string;
  publicKeyToken: string;
  targetFramework: string;
  isStrongNamed: boolean;
  runtimeVersion: string;
}

// ── Parser: monodis --assembly output ────────────────────────────────────────

export function parseMonodisOutput(output: string): Partial<DotNetInfoRow> {
  const result: Partial<DotNetInfoRow> = {};
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Name:')) result.name = trimmed.replace('Name:', '').trim();
    else if (trimmed.startsWith('Version:')) result.version = trimmed.replace('Version:', '').trim();
    else if (trimmed.startsWith('Culture:')) result.culture = trimmed.replace('Culture:', '').trim();
    else if (trimmed.startsWith('Public Key Token:')) {
      result.publicKeyToken = trimmed.replace('Public Key Token:', '').trim();
      result.isStrongNamed = result.publicKeyToken !== 'null' && result.publicKeyToken !== '';
    }
    else if (trimmed.startsWith('Runtime Version:')) result.runtimeVersion = trimmed.replace('Runtime Version:', '').trim();
  }
  return result;
}

// ── Parser: PowerShell reflection output (tab-separated) ─────────────────────

export function parsePsReflectionOutput(output: string): DotNetInfoRow | null {
  const parts = output.split('\t');
  if (parts.length < 5) return null;
  const [name, version, culture, publicKeyToken, targetFramework, runtimeVersion] = parts;
  if (!name || !version) return null;
  return {
    name: (name ?? '').trim(),
    version: (version ?? '').trim(),
    culture: (culture ?? 'neutral').trim(),
    publicKeyToken: (publicKeyToken ?? '').trim(),
    targetFramework: (targetFramework ?? '').trim(),
    isStrongNamed: !!publicKeyToken && publicKeyToken.trim() !== '' && publicKeyToken.trim() !== 'null',
    runtimeVersion: (runtimeVersion ?? '').trim(),
  };
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function runDotNetInfo(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const filePath = parseArg(args, '--file');
  if (!filePath) {
    return buildError('dotnet-info requires --file <path>', 'EXEC_FAILED', 'dotnet-info');
  }

  // Linux (non-WSL): try monodis
  if (process.platform === 'linux' && !process.env['WSL_DISTRO_NAME']) {
    try {
      const { stdout } = await execCmd(`monodis --assembly "${filePath}"`, 10000);
      const partial = parseMonodisOutput(stdout);
      if (partial.name) {
        const row: DotNetInfoRow = {
          name: partial.name ?? '',
          version: partial.version ?? '',
          culture: partial.culture ?? 'neutral',
          publicKeyToken: partial.publicKeyToken ?? '',
          targetFramework: '',
          isStrongNamed: partial.isStrongNamed ?? false,
          runtimeVersion: partial.runtimeVersion ?? '',
        };
        return buildSuccess([row], 'dotnet-info', platform);
      }
    } catch {
      // monodis not available
    }
    // Stub for Linux without mono
    return buildSuccess(
      [{ note: 'dotnet-info requires Mono (monodis) on Linux. Install mono-utils package.' }],
      'dotnet-info',
      platform,
    );
  }

  // Windows or WSL: PowerShell reflection
  const guardErr = assertWindowsOrWsl('dotnet-info');
  if (guardErr) return guardErr;

  const script = `
try {
  Add-Type -AssemblyName System.Reflection
  $a = [System.Reflection.AssemblyName]::GetAssemblyName('${filePath.replace(/'/g, "''")}')
  $name = $a.Name
  $version = $a.Version.ToString()
  $culture = if ($a.CultureName) { $a.CultureName } else { 'neutral' }
  $pkt = if ($a.GetPublicKeyToken()) { [BitConverter]::ToString($a.GetPublicKeyToken()).Replace('-','').ToLower() } else { '' }
  $target = ''
  try {
    $asm = [System.Reflection.Assembly]::ReflectionOnlyLoadFrom('${filePath.replace(/'/g, "''")}')
    $attrs = $asm.GetCustomAttributesData() | Where-Object { $_.AttributeType.FullName -eq 'System.Runtime.Versioning.TargetFrameworkAttribute' }
    if ($attrs) { $target = $attrs[0].ConstructorArguments[0].Value }
  } catch {}
  "$name\t$version\t$culture\t$pkt\t$target\tv4.0"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
`.trim();

  try {
    const { stdout } = await execPs(script, 15000);
    if (stdout.startsWith('ERROR:')) {
      return buildError(`dotnet-info: ${stdout}`, 'EXEC_FAILED', 'dotnet-info');
    }
    const row = parsePsReflectionOutput(stdout);
    if (!row) {
      return buildError('dotnet-info: failed to parse PowerShell output', 'EXEC_FAILED', 'dotnet-info');
    }
    return buildSuccess([row], 'dotnet-info', platform);
  } catch (err) {
    return buildError(`dotnet-info failed: ${String(err)}`, 'EXEC_FAILED', 'dotnet-info');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'dotnet-info') return runDotNetInfo(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
