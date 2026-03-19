import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPidNumeric, isPathAllowed } from '../utils/common.js';
import { config } from '../config.js';
import os from 'node:os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function getDefaultShell(): string | undefined {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  }

  return process.env.SHELL || '/bin/sh';
}

function buildCommandEnv(cwd?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const homeDir =
    env.USERPROFILE ||
    env.HOME ||
    (process.platform === 'win32'
      ? (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : undefined)
      : os.homedir());

  if (homeDir) {
    env.USERPROFILE ??= homeDir;
    env.HOME ??= homeDir;
  }

  if (cwd) {
    env.PWD = cwd;
  }

  return env;
}

function assertPathAllowed(resolvedPath: string, label: string): void {
  if (!isPathAllowed(resolvedPath, config.system?.allowedPaths)) {
    throw new Error(`${label} not in allowedPaths. Configure system.allowedPaths in config.yaml.`);
  }
}

export const systemTools = [
  // Command Execution
  {
    name: 'sys_runCommand',
    description: 'Shell runs the command.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['command'],
    },
    handler: async (args: unknown) => {
      const { command, cwd } = z
        .object({ command: z.string(), cwd: z.string().optional() })
        .parse(args);
      if (cwd) assertPathAllowed(path.resolve(cwd), 'cwd');
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          env: buildCommandEnv(cwd),
          shell: getDefaultShell(),
          windowsHide: true,
        });
        return {
          content: [
            {
              type: 'text',
              text: `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
            },
          ],
        };
      } catch (e: unknown) {
        const err = e as { message?: string; stdout?: string; stderr?: string };
        return {
          content: [
            {
              type: 'text',
              text: `❌ Command error:\n${err?.message ?? ''}\n\nSTDOUT:\n${err?.stdout ?? ''}\n\nSTDERR:\n${err?.stderr ?? ''}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  // Process Management
  {
    name: 'sys_listProcesses',
    description:
      'Lists running processes (tasklist/ps). Optionally filter by process name. ' +
      'If name is provided, returns only processes matching that name (e.g. node.exe, chrome.exe). ' +
      'If name is omitted, lists all processes. Use limit to cap output rows (default: 100).',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Process name to filter by (e.g. node.exe, chrome.exe). Optional.',
        },
        limit: {
          type: 'number',
          description: 'Max number of process rows to return when listing all (default: 100). Ignored when name is provided.',
        },
      },
      required: [],
    },
    handler: async (args: unknown) => {
      const { name, limit } = z
        .object({ name: z.string().optional(), limit: z.number().optional() })
        .parse(args);

      // Filter by name: legacy sys_listProcessByName logic
      if (name !== undefined) {
        if (process.platform === 'win32') {
          try {
            const { stdout } = await execAsync(
              `tasklist /FI "IMAGENAME eq ${name}" /FO CSV /V`,
            );
            return {
              content: [{ type: 'text', text: stdout || `No ${name} found.` }],
            };
          } catch {
            return {
              content: [{ type: 'text', text: `No ${name} found.` }],
            };
          }
        } else {
          const { stdout } = await execAsync(`ps aux | grep ${name}`);
          return {
            content: [{ type: 'text', text: stdout || `No ${name} found.` }],
          };
        }
      }

      // List all: legacy sys_listProcesses logic
      const maxRows = limit ?? 100;
      let cmd = 'tasklist /FO CSV';
      if (process.platform !== 'win32') {
        cmd = 'ps -o pid,user,comm,args';
      }
      const { stdout } = await execAsync(cmd);
      const lines = stdout.split('\n');
      const total = lines.length;
      const truncated = lines.slice(0, maxRows + 1).join('\n');
      const suffix = total > maxRows + 1 ? `\n... [truncated: showing ${maxRows} of ${total - 1} processes]` : '';
      return {
        content: [{ type: 'text', text: truncated + suffix }],
      };
    },
  },
  {
    name: 'sys_killProcess',
    description:
      'Terminates a process by PID or by name. At least one of pid or name must be provided. ' +
      'If pid is provided, terminates the specific process with that PID (taskkill /PID / kill -9). ' +
      'If name is provided, terminates all processes matching that name (e.g. node.exe, chrome.exe). ' +
      'The force parameter applies only to name-based termination (default: true).',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'string',
          description: 'PID of the process to terminate. Optional, but pid or name must be given.',
        },
        name: {
          type: 'string',
          description: 'Process name to terminate (e.g. node.exe, chrome.exe). Optional, but pid or name must be given.',
        },
        force: {
          type: 'boolean',
          description: 'Force terminate when killing by name (default: true).',
        },
      },
      required: [],
    },
    handler: async (args: unknown) => {
      const { pid, name, force } = z
        .object({
          pid: z.string().optional(),
          name: z.string().optional(),
          force: z.boolean().optional(),
        })
        .parse(args);

      if (!pid && !name) {
        throw new Error('At least one of "pid" or "name" must be provided.');
      }

      // Kill by PID: legacy sys_killProcess logic
      if (pid !== undefined) {
        assertPidNumeric(pid);
        if (process.platform === 'win32') {
          await execFileAsync('taskkill', ['/PID', pid, '/F']);
        } else {
          await execFileAsync('kill', ['-9', pid]);
        }
        return {
          content: [{ type: 'text', text: `✓ Process terminated: PID ${pid}` }],
        };
      }

      // Kill by name: legacy sys_killProcessByName logic
      const processName = name!;
      const forceFlag = force !== false;

      if (process.platform === 'win32') {
        try {
          const cmd = `taskkill /IM ${processName} ${forceFlag ? '/F' : ''}`;
          const { stdout: out, stderr: err } = await execAsync(cmd);
          return {
            content: [
              {
                type: 'text',
                text: `✓ ${processName} operations have been terminated.\n\n${out}${err}`,
              },
            ],
          };
        } catch (e: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: `⚠ ${processName} could not be terminated or found:\n${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          };
        }
      } else {
        await execAsync(`pkill ${forceFlag ? '-9' : ''} ${processName}`);
        return {
          content: [{ type: 'text', text: `✓ ${processName} processes have been terminated.` }],
        };
      }
    },
  },
  {
    name: 'sys_uninstallApp',
    description:
      'Uninstalls the application installed on Windows. You can use the full name or partial name of the app.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: {
          type: 'string',
          description: 'App name to uninstall (partial match supported)',
        },
        silent: {
          type: 'boolean',
          description: 'Silent removal (without user interaction, default: false)',
        },
      },
      required: ['appName'],
    },
    handler: async (args: unknown) => {
      const { appName, silent: _silent } = z
        .object({
          appName: z.string(),
          silent: z.boolean().optional(),
        })
        .parse(args);
      void _silent; // schema supports it, reserved for future use

      if (process.platform !== 'win32') {
        return {
          content: [{ type: 'text', text: '⚠ App uninstallation is only supported on Windows.' }],
          isError: true,
        };
      }

      try {
        if (!/^[a-zA-Z0-9\s._-]{1,100}$/.test(appName)) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ appName may only contain letters, numbers, spaces, dots, hyphens, underscores (max 100 chars)',
              },
            ],
            isError: true,
          };
        }
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        const script = `Get-WmiObject -Class Win32_Product | Where-Object { $_.Name -like '*${appName}*' } | Select-Object Name, Version, IdentifyingNumber | ConvertTo-Json`;
        const { stdout: searchResult } = (await execFileAsync('powershell', [
          '-NoProfile',
          '-Command',
          script,
        ])) as { stdout: string; stderr: string };

        if (!searchResult || searchResult.trim() === '') {
          return {
            content: [
              {
                type: 'text',
                text: `❌ No applications were found containing "${appName}".\n\nTip: You can list all installed applications with the "wmic product get name" command.`,
              },
            ],
            isError: true,
          };
        }

        let apps;
        try {
          apps = JSON.parse(searchResult);
          if (!Array.isArray(apps)) {
            apps = [apps];
          }
        } catch {
          return {
            content: [
              { type: 'text', text: `❌ The application search result could not be processed.` },
            ],
            isError: true,
          };
        }

        // Show found apps
        const appList = apps
          .map((app: { Name?: string; Version?: string }) => `- ${app.Name} (v${app.Version})`)
          .join('\n');

        if (apps.length === 0) {
          return {
            content: [{ type: 'text', text: `❌ No applications found containing "${appName}".` }],
            isError: true,
          };
        }

        // Uninstall first matching app
        const appToUninstall = apps[0];
        const uninstallCmd = `(Get-WmiObject -Class Win32_Product | Where-Object { $_.IdentifyingNumber -eq "${appToUninstall.IdentifyingNumber}" }).Uninstall()`;

        let resultText = `📋 Found apps:\n${appList}\n\n🔄 Removing "${appToUninstall.Name}"...\n\n`;

        try {
          await execAsync(`powershell -Command "${uninstallCmd}"`, { timeout: 300000 }); // 5 min timeout
          resultText += `✅ Successfully removed "${appToUninstall.Name}".`;
        } catch (e: unknown) {
          resultText += `⚠ Error during uninstallation: ${e instanceof Error ? e.message : String(e)}\n\nNote: Some applications may require manual uninstallation.`;
        }

        return {
          content: [{ type: 'text', text: resultText }],
        };
      } catch (e: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Application uninstall error: ${e instanceof Error ? e.message : String(e)}\n\nTip: This operation may require admin privileges.`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  // Task Scheduler
  {
    name: 'sys_scheduledTask',
    description:
      'Manages scheduled tasks. Use action="list" to list all scheduled tasks (schtasks/crontab), ' +
      'optionally filtered by filter string. Use action="run" to trigger a specific scheduled task by taskName (Windows only).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'run'],
          description: '"list" to list scheduled tasks, "run" to trigger a task.',
        },
        filter: {
          type: 'string',
          description: 'Optional filter string for action="list". Only tasks whose name contains this string are shown.',
        },
        taskName: {
          type: 'string',
          description: 'Task name to run. Required when action="run".',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, filter, taskName } = z
        .object({
          action: z.enum(['list', 'run']),
          filter: z.string().optional(),
          taskName: z.string().optional(),
        })
        .parse(args);

      // action=list: legacy sys_listScheduledTasks logic
      if (action === 'list') {
        if (process.platform === 'win32') {
          const cmd = filter
            ? `schtasks /query /FO CSV /FI "TASKNAME eq *${filter}*"`
            : 'schtasks /query /FO CSV';
          const { stdout } = await execAsync(cmd);
          return {
            content: [{ type: 'text', text: stdout }],
          };
        } else {
          try {
            const { stdout } = await execAsync('crontab -l');
            const result = filter
              ? stdout.split('\n').filter((line) => line.includes(filter)).join('\n')
              : stdout;
            return {
              content: [{ type: 'text', text: result }],
            };
          } catch {
            return {
              content: [{ type: 'text', text: 'No cron jobs found or crontab not available.' }],
            };
          }
        }
      }

      // action=run: legacy sys_runScheduledTask logic
      if (!taskName) {
        throw new Error('"taskName" is required when action is "run".');
      }
      if (process.platform === 'win32') {
        await execAsync(`schtasks /run /TN "${taskName}"`);
        return {
          content: [{ type: 'text', text: `✓ Task triggered: ${taskName}` }],
        };
      } else {
        throw new Error('Scheduled task triggering is not supported on Linux.');
      }
    },
  },
  {
    name: 'sys_getSystemInfo',
    description: 'Returns system information (OS, CPU, RAM, uptime).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const os = await import('node:os');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                platform: os.platform(),
                arch: os.arch(),
                cpus: os.cpus().length,
                totalMemory: os.totalmem(),
                freeMemory: os.freemem(),
                uptime: os.uptime(),
                hostname: os.hostname(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
];
