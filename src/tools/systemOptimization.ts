// System Optimization Tools v3.0 - Consolidated Edition
// Admin authorized operation and comprehensive optimization tools
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const BASE_PATH = path.join(__dirname_esm, '..', '..', 'system-optimization');

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Run PowerShell script as Administrator
 */
// Used for future admin-elevated script execution
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for admin operations
async function runAsAdmin(scriptPath: string): Promise<string> {
  assertScriptExists(scriptPath);
  const psCommand = `Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"' -Verb RunAs -Wait`;

  try {
    const { stdout, stderr } = await execAsync(`powershell -Command "${psCommand}"`);
    return stdout || stderr || 'Script has been run.';
  } catch (error: unknown) {
    throw new Error(
      `Admin script error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Run batch file as Administrator
 */
async function runBatchAsAdmin(batchPath: string): Promise<string> {
  assertScriptExists(batchPath);
  const psCommand = `Start-Process cmd -ArgumentList '/c "${batchPath}"' -Verb RunAs -Wait`;

  try {
    const { stdout, stderr } = await execAsync(`powershell -Command "${psCommand}"`);
    return stdout || stderr || 'Batch file has been run.';
  } catch (error: unknown) {
    throw new Error(`Admin batch error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if a script file exists before running
 */
function assertScriptExists(scriptPath: string): void {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `Script not found: ${scriptPath}\nThe 'system-optimization' directory with PowerShell scripts is required. Run 'hakanmcp doctor' for details.`,
    );
  }
}

/**
 * Run normal PowerShell script (no admin)
 */
async function runPowerShell(scriptPath: string, args: string = ''): Promise<string> {
  assertScriptExists(scriptPath);
  try {
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" ${args}`,
      { maxBuffer: 10 * 1024 * 1024 }, // 10MB buffer
    );
    return stdout || stderr || 'Script has been run.';
  } catch (error: unknown) {
    throw new Error(`PowerShell error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run PowerShell command directly
 */
async function runPowerShellCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${command}"`,
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout || stderr || 'The command has been run.';
  } catch (error: unknown) {
    throw new Error(`PowerShell error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ==================== TOOL DEFINITIONS ====================

export const systemOptimizationTools = [
  // 1. CLEANUP (consolidated: auto_cleanup, ram_cleanup, docker_cleanup)
  {
    name: 'sysopt_cleanup',
    description:
      'Performs system cleanup. target=auto: Temp/Cache/Browser/Windows Update/Event Logs/Thumbnail Cache. target=ram: Standby memory/DNS cache/Event logs/Temp files. target=docker: Container/Image/Volume/Build Cache.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['auto', 'ram', 'docker'],
          description: 'Cleanup target: auto | ram | docker',
        },
      },
      required: ['target'],
    },
    handler: async (args: unknown): Promise<ToolResult> => {
      const a = args as Record<string, unknown>;
      const target = a?.target as string;

      const scriptMap: Record<string, { file: string; label: string }> = {
        auto: { file: 'auto_cleanup.ps1', label: '🧹 Automatic Cleanup Completed' },
        ram: { file: 'ram_cleanup.ps1', label: '💾 RAM Cleanup Completed' },
        docker: { file: 'docker_cleanup.ps1', label: '🐳 Docker Cleanup Completed' },
      };

      const entry = scriptMap[target];
      if (!entry) {
        return {
          content: [{ type: 'text', text: `❌ Unknown target: ${target}. Use: auto | ram | docker` }],
          isError: true,
        };
      }

      const scriptPath = path.join(BASE_PATH, 'scripts', 'cleanup', entry.file);
      const result = await runPowerShell(scriptPath);

      return {
        content: [{ type: 'text', text: `${entry.label}:\n\n${result}` }],
      };
    },
  },

  // 2. OPTIMIZE (consolidated: registry, network, gaming, ssd, performance, startup)
  {
    name: 'sysopt_optimize',
    description:
      'Runs a targeted system optimization. target=registry: Visual Effects/Menu Delay/Explorer/Telemetry/Network Throttling/Game Mode. target=network: DNS/TCP-IP/Nagle/ARP. target=gaming: Game Mode/Mouse/Fullscreen/Power/GPU. target=ssd: TRIM/Superfetch/Prefetch/Indexing/Last Access. target=performance: Visual effects/Explorer/Search/Disk/Power. target=startup: Removes unnecessary startup programs.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['registry', 'network', 'gaming', 'ssd', 'performance', 'startup'],
          description: 'Optimization target: registry | network | gaming | ssd | performance | startup',
        },
      },
      required: ['target'],
    },
    handler: async (args: unknown): Promise<ToolResult> => {
      const a = args as Record<string, unknown>;
      const target = a?.target as string;

      const labelMap: Record<string, string> = {
        registry: '⚙️ Registry Optimization Completed',
        network: '🌐 Network Optimization Completed',
        gaming: '🎮 Gaming Optimization Completed',
        ssd: '💿 SSD Optimization Completed',
        performance: '⚡ Performance Optimization Completed',
        startup: '🚀 Startup Optimization Completed',
      };

      const label = labelMap[target];
      if (!label) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Unknown target: ${target}. Use: registry | network | gaming | ssd | performance | startup`,
            },
          ],
          isError: true,
        };
      }

      const scriptPath = path.join(BASE_PATH, 'scripts', 'optimization', `${target}.ps1`);
      const result = await runPowerShell(scriptPath);

      return {
        content: [{ type: 'text', text: `${label}:\n\n${result}` }],
      };
    },
  },

  // 3. RUN ADMIN TASK (consolidated: main_panel, service_optimize, scheduled_tasks)
  {
    name: 'sysopt_run_admin',
    description:
      'Runs an admin-elevated task. task=main_panel: Launches the main optimization panel. task=service: Stops/disables unnecessary services (permanent). task=scheduled_tasks: Creates weekly cleanup and daily RAM optimization scheduled tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: ['main_panel', 'service', 'scheduled_tasks'],
          description: 'Admin task to run: main_panel | service | scheduled_tasks',
        },
      },
      required: ['task'],
    },
    handler: async (args: unknown): Promise<ToolResult> => {
      const a = args as Record<string, unknown>;
      const task = a?.task as string;

      const taskMap: Record<string, { file: string; label: string }> = {
        main_panel: { file: 'MAIN_PANEL.bat', label: '✅ Main panel started' },
        service: { file: 'SERVICE_OPTIMIZE.bat', label: '🔧 Service Optimization Completed' },
        scheduled_tasks: { file: 'SCHEDULED_TASKS.bat', label: '⏰ Scheduled Tasks Created' },
      };

      const entry = taskMap[task];
      if (!entry) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Unknown task: ${task}. Use: main_panel | service | scheduled_tasks`,
            },
          ],
          isError: true,
        };
      }

      const batchPath = path.join(BASE_PATH, 'bin', entry.file);
      const result = await runBatchAsAdmin(batchPath);

      return {
        content: [{ type: 'text', text: `${entry.label}\n\n${result}` }],
      };
    },
  },

  // 4. SYSTEM STATUS ANALYSIS (unchanged)
  {
    name: 'sysopt_analyze_system',
    description:
      'Performs comprehensive system status analysis (CPU, RAM, Disk, GPU, Services, Startup, Browser Cache, Network). A detailed report is returned in JSON format.',
    inputSchema: {
      type: 'object',
      properties: {
        jsonOutput: {
          type: 'boolean',
          description: 'true to output in JSON format',
        },
      },
      required: [],
    },
    handler: async (args: unknown): Promise<ToolResult> => {
      const scriptPath = path.join(BASE_PATH, 'scripts', 'analysis', 'system_status.ps1');
      const a = args as Record<string, unknown>;
      const jsonArg = a?.jsonOutput ? '-JsonOutput' : '';
      const result = await runPowerShell(scriptPath, jsonArg);

      return {
        content: [
          {
            type: 'text',
            text: a?.jsonOutput ? result : `📊 Sistem Durumu Analizi:\n\n${result}`,
          },
        ],
      };
    },
  },

  // 5. QUICK STATUS (unchanged)
  {
    name: 'sysopt_quick_status',
    description: 'Gives quick system status summary (CPU, RAM, Disk usage)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async (): Promise<ToolResult> => {
      const command = `
        $cpu = (Get-CimInstance Win32_Processor).LoadPercentage
        $os = Get-CimInstance Win32_OperatingSystem
        $totalRam = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
        $freeRam = [math]::Round($os.FreePhysicalMemory/1MB, 1)
        $usedRam = $totalRam - $freeRam
        $ramPercent = [math]::Round(($usedRam/$totalRam)*100, 1)

        $disks = Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Used -gt 0}
        $diskInfo = $disks | ForEach-Object {
          $usedGB = [math]::Round($_.Used/1GB, 1)
          $totalGB = [math]::Round(($_.Used + $_.Free)/1GB, 1)
          $percent = [math]::Round(($usedGB/$totalGB)*100, 1)
          "$($_.Name): $usedGB/$totalGB GB (%$percent)"
        }

        Write-Output "CPU: $cpu%"
        Write-Output "RAM: $usedRam/$totalRam GB (%$ramPercent)"
        Write-Output "DISK:"
        $diskInfo | ForEach-Object { Write-Output "  $_" }
      `;
      const result = await runPowerShellCommand(command);

      return {
        content: [
          {
            type: 'text',
            text: `📈 Quick System Status:\n\n${result}`,
          },
        ],
      };
    },
  },

  // 6. FULL OPTIMIZATION (unchanged)
  {
    name: 'sysopt_full_optimize',
    description:
      'Runs all optimizations at once (Analysis + Cleaning + RAM + Registry + Network + SSD + Gaming + Performance)',
    inputSchema: {
      type: 'object',
      properties: {
        skipDocker: {
          type: 'boolean',
          description: 'Skip Docker cleanup',
        },
      },
      required: [],
    },
    handler: async (args: unknown): Promise<ToolResult> => {
      let results: string[] = [];

      try {
        // 1. Analysis
        results.push('📊 [1/8] Sistem Analizi...');
        const analysisPath = path.join(BASE_PATH, 'scripts', 'analysis', 'system_status.ps1');
        results.push(await runPowerShell(analysisPath));

        // 2. Auto Cleanup
        results.push('\n🧹 [2/8] Otomatik Temizlik...');
        const cleanupPath = path.join(BASE_PATH, 'scripts', 'cleanup', 'auto_cleanup.ps1');
        results.push(await runPowerShell(cleanupPath));

        // 3. RAM Cleanup
        results.push('\\n💾 [3/8] RAM Cleaning...');
        const ramPath = path.join(BASE_PATH, 'scripts', 'cleanup', 'ram_cleanup.ps1');
        results.push(await runPowerShell(ramPath));

        // 4. Docker Cleanup (optional)
        if (!(args as Record<string, unknown>)?.skipDocker) {
          results.push('\\n🐳 [4/8] Docker Cleanup...');
          const dockerPath = path.join(BASE_PATH, 'scripts', 'cleanup', 'docker_cleanup.ps1');
          try {
            results.push(await runPowerShell(dockerPath));
          } catch {
            results.push('Docker cleanup skipped (Docker may not be running)');
          }
        } else {
          results.push('\\n🐳 [4/8] Docker Cleanup skipped (user request)');
        }

        // 5. Registry Optimization
        results.push('\n⚙️ [5/8] Registry Optimizasyonu...');
        const registryPath = path.join(BASE_PATH, 'scripts', 'optimization', 'registry.ps1');
        results.push(await runPowerShell(registryPath));

        // 6. Network Optimization
        results.push('\n🌐 [6/8] Network Optimizasyonu...');
        const networkPath = path.join(BASE_PATH, 'scripts', 'optimization', 'network.ps1');
        results.push(await runPowerShell(networkPath));

        // 7. SSD Optimization
        results.push('\n💿 [7/8] SSD Optimizasyonu...');
        const ssdPath = path.join(BASE_PATH, 'scripts', 'optimization', 'ssd.ps1');
        results.push(await runPowerShell(ssdPath));

        // 8. Performance Optimization
        results.push('\n⚡ [8/8] Performans Optimizasyonu...');
        const perfPath = path.join(BASE_PATH, 'scripts', 'optimization', 'performance.ps1');
        results.push(await runPowerShell(perfPath));
      } catch (error: unknown) {
        results.push(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ ALL OPTIMIZATIONS ARE COMPLETE!\n\n${results.join('\n')}\n\n🔄 Restart the computer for the full effect of the changes.`,
          },
        ],
      };
    },
  },

  // 7. VIEW LOGS (unchanged)
  {
    name: 'sysopt_view_logs',
    description: 'Displays optimization log files',
    inputSchema: {
      type: 'object',
      properties: {
        lines: {
          type: 'number',
          description: 'Last number of rows to show (default: 50)',
        },
      },
      required: [],
    },
    handler: async (args: unknown): Promise<ToolResult> => {
      const logPath = path.join(BASE_PATH, 'logs', 'cleanup.log');
      const lines = Number((args as Record<string, unknown>)?.lines) || 50;

      try {
        if (fs.existsSync(logPath)) {
          const content = fs.readFileSync(logPath, 'utf8');
          const logLines = content.split('\n').slice(-lines).join('\n');
          return {
            content: [
              {
                type: 'text',
                text: `📋 Last ${lines} Log Record:\n\n${logLines}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: '📋 The log file has not been created yet.',
              },
            ],
          };
        }
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Log reading error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
];
