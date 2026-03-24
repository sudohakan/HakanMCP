import { z } from 'zod';
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
  {
    name: 'sys',
    description:
      'System operations. Actions: runCommand, listProcesses, killProcess, uninstallApp, listScheduledTasks, runScheduledTask, getSystemInfo.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'runCommand',
            'listProcesses',
            'killProcess',
            'uninstallApp',
            'listScheduledTasks',
            'runScheduledTask',
            'getSystemInfo',
          ],
          description: 'Operation to perform',
        },
        command: { type: 'string', description: 'Shell command to run (runCommand)' },
        cwd: { type: 'string', description: 'Working directory (runCommand, optional)' },
        name: { type: 'string', description: 'Process name to filter/kill or app name to uninstall' },
        limit: { type: 'number', description: 'Max rows when listing all processes (default: 100)' },
        pid: { type: 'string', description: 'Process PID to terminate (killProcess)' },
        force: { type: 'boolean', description: 'Force terminate when killing by name (default: true)' },
        silent: { type: 'boolean', description: 'Silent uninstall (uninstallApp, default: false)' },
        filter: { type: 'string', description: 'Filter string for listScheduledTasks' },
        taskName: { type: 'string', description: 'Task name to run (runScheduledTask)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, command, cwd, name, limit, pid, force, silent: _silent, filter, taskName } = z
        .object({
          action: z.enum([
            'runCommand',
            'listProcesses',
            'killProcess',
            'uninstallApp',
            'listScheduledTasks',
            'runScheduledTask',
            'getSystemInfo',
          ]),
          command: z.string().optional(),
          cwd: z.string().optional(),
          name: z.string().optional(),
          limit: z.number().optional(),
          pid: z.string().optional(),
          force: z.boolean().optional(),
          silent: z.boolean().optional(),
          filter: z.string().optional(),
          taskName: z.string().optional(),
        })
        .parse(args);

      switch (action) {
        case 'runCommand': {
          if (!command) throw new Error('command is required for action=runCommand');
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
        }

        case 'listProcesses': {
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
        }

        case 'killProcess': {
          if (!pid && !name) {
            throw new Error('At least one of "pid" or "name" must be provided.');
          }

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
        }

        case 'uninstallApp': {
          if (!name) throw new Error('name is required for action=uninstallApp');
          void _silent;

          if (process.platform !== 'win32') {
            return {
              content: [{ type: 'text', text: '⚠ App uninstallation is only supported on Windows.' }],
              isError: true,
            };
          }

          try {
            if (!/^[a-zA-Z0-9\s._-]{1,100}$/.test(name)) {
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
            const { execFile: execFileLocal } = await import('node:child_process');
            const { promisify: promisifyLocal } = await import('node:util');
            const execFileAsyncLocal = promisifyLocal(execFileLocal);
            const script = `Get-WmiObject -Class Win32_Product | Where-Object { $_.Name -like '*${name}*' } | Select-Object Name, Version, IdentifyingNumber | ConvertTo-Json`;
            const { stdout: searchResult } = (await execFileAsyncLocal('powershell', [
              '-NoProfile',
              '-Command',
              script,
            ])) as { stdout: string; stderr: string };

            if (!searchResult || searchResult.trim() === '') {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ No applications were found containing "${name}".\n\nTip: You can list all installed applications with the "wmic product get name" command.`,
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

            const appList = apps
              .map((app: { Name?: string; Version?: string }) => `- ${app.Name} (v${app.Version})`)
              .join('\n');

            if (apps.length === 0) {
              return {
                content: [{ type: 'text', text: `❌ No applications found containing "${name}".` }],
                isError: true,
              };
            }

            const appToUninstall = apps[0];
            const uninstallCmd = `(Get-WmiObject -Class Win32_Product | Where-Object { $_.IdentifyingNumber -eq "${appToUninstall.IdentifyingNumber}" }).Uninstall()`;

            let resultText = `📋 Found apps:\n${appList}\n\n🔄 Removing "${appToUninstall.Name}"...\n\n`;

            try {
              await execAsync(`powershell -Command "${uninstallCmd}"`, { timeout: 300000 });
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
        }

        case 'listScheduledTasks': {
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

        case 'runScheduledTask': {
          if (!taskName) throw new Error('taskName is required for action=runScheduledTask');
          if (process.platform === 'win32') {
            await execAsync(`schtasks /run /TN "${taskName}"`);
            return {
              content: [{ type: 'text', text: `✓ Task triggered: ${taskName}` }],
            };
          } else {
            throw new Error('Scheduled task triggering is not supported on Linux.');
          }
        }

        case 'getSystemInfo': {
          const osModule = await import('node:os');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    platform: osModule.platform(),
                    arch: osModule.arch(),
                    cpus: osModule.cpus().length,
                    totalMemory: osModule.totalmem(),
                    freeMemory: osModule.freemem(),
                    uptime: osModule.uptime(),
                    hostname: osModule.hostname(),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }
    },
  },
];
