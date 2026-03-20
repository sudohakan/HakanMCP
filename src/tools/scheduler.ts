import { z } from 'zod';
import cron, { ScheduledTask as CronScheduledTask } from 'node-cron';
import fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { atomicWriteFileSync } from '../utils/common.js';
import { config } from '../config.js';
import { syncPeerRepo } from '../utils/peerSync.js';

/**
 * Scheduler Tools - Cron-based periodic task scheduling for AI Agents
 * Enables automatic, recurring tasks with full lifecycle management
 */

interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  agentTask: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  failCount: number;
  consecutiveFailCount?: number;
  context?: Record<string, unknown>;
}

interface TaskExecution {
  taskId: string;
  timestamp: string;
  status: 'success' | 'failed' | 'timeout';
  duration: number;
  result?: string;
  error?: string;
}

class SchedulerManager {
  private logger = logger.child({ tool: 'scheduler', operation: 'manager' });
  private tasks: Map<string, ScheduledTask> = new Map();
  private cronJobs: Map<string, CronScheduledTask> = new Map();
  private executions: TaskExecution[] = [];
  private persistencePath: string;
  private maxHistorySize: number = 200;

  constructor() {
    this.persistencePath = config.scheduler?.persistencePath || './scheduler-state.json';

    if (process.env.NODE_ENV === 'test' || process.env.SCHEDULER_DISABLED_FOR_TESTS === '1') {
      this.logger.info('Scheduler disabled for test environment');
      return;
    }

    this.loadState();

    this.logger.info('SchedulerManager initialized', {
      persistencePath: this.persistencePath,
      tasksLoaded: this.tasks.size,
    });
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.persistencePath)) {
        const data = fs.readFileSync(this.persistencePath, 'utf8');
        const state = JSON.parse(data);

        if (state.tasks && Array.isArray(state.tasks)) {
          state.tasks.forEach((task: ScheduledTask) => {
            this.tasks.set(task.id, task);

            if (task.enabled && config.scheduler?.enabled !== false) {
              this.startCronJob(task);
            }
          });
        }

        if (state.executions && Array.isArray(state.executions)) {
          this.executions = state.executions.slice(-this.maxHistorySize);
        }

        this.logger.info('Scheduler state loaded', {
          tasks: this.tasks.size,
          executions: this.executions.length,
        });
      }
    } catch (error) {
      this.logger.error('Failed to load scheduler state', error);
    }
  }

  private saveState(): void {
    try {
      const state = {
        tasks: Array.from(this.tasks.values()),
        executions: this.executions.slice(-this.maxHistorySize),
        lastSaved: new Date().toISOString(),
      };

      atomicWriteFileSync(this.persistencePath, JSON.stringify(state, null, 2));
    } catch (error) {
      this.logger.error('Failed to save scheduler state', error);
    }
  }

  private startCronJob(task: ScheduledTask): void {
    try {
      if (!cron.validate(task.schedule)) {
        throw new Error(`Invalid cron schedule: ${task.schedule}`);
      }

      const job = cron.schedule(task.schedule, async () => {
        await this.executeTask(task.id);
      });

      this.cronJobs.set(task.id, job);
      job.start();

      const nextRun = this.getNextRunTime(task.schedule);
      task.nextRun = nextRun?.toISOString();

      this.logger.info('Cron job started', {
        taskId: task.id,
        schedule: task.schedule,
        nextRun: task.nextRun,
      });
    } catch (error: unknown) {
      this.logger.error('Failed to start cron job', error, { taskId: task.id });
      throw error;
    }
  }

  private stopCronJob(taskId: string): void {
    const job = this.cronJobs.get(taskId);
    if (job) {
      job.stop();
      this.cronJobs.delete(taskId);
      this.logger.info('Cron job stopped', { taskId });
    }
  }

  private getNextRunTime(_schedule: string): Date | null {
    return null;
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.warn('Task not found for execution', { taskId });
      return;
    }

    const taskLogger = logger.child({ tool: 'scheduler', operation: task.name });

    const startTime = Date.now();
    const runId = `sched-${taskId}-${startTime}`;
    const execution: TaskExecution = {
      taskId,
      timestamp: new Date().toISOString(),
      status: 'success',
      duration: 0,
    };

    try {
      taskLogger.info('Executing scheduled task', {
        taskId,
        name: task.name,
        agentTask: task.agentTask,
        runId,
      });

      if (task.agentTask === 'sync-peer') {
        const peerPath = (task.context as Record<string, unknown>)?.peerPath as string | undefined;
        const syncResult = await syncPeerRepo(peerPath);

        execution.result = `${syncResult.status}: ${syncResult.detail}`;
        execution.status = syncResult.status === 'synced' ? 'success' : 'failed';

        task.runCount++;
        task.lastRun = execution.timestamp;
        task.nextRun = this.getNextRunTime(task.schedule)?.toISOString();
        if (execution.status === 'success') {
          task.consecutiveFailCount = 0;
        } else {
          task.failCount++;
          const cfc = (task.consecutiveFailCount ?? 0) + 1;
          task.consecutiveFailCount = cfc;
          if (cfc >= 3) {
            task.enabled = false;
            this.stopCronJob(taskId);
            taskLogger.warn('Task disabled after 3 consecutive failures', {
              taskId,
              name: task.name,
            });
          }
        }
        taskLogger.info('Sync peer task finished', { execution });
        return;
      }

      const { aiTools } = await import('./aiTools.js');
      const chatTool = aiTools?.find((t: { name: string }) => t.name === 'ai_chat');

      if (chatTool) {
        const result = await chatTool.handler({
          messages: [{ role: 'user', content: task.agentTask }],
          allowLocalFallback: false,
        });

        execution.result = result.content?.[0]?.text || 'Task completed';
        execution.status = 'success';

        task.runCount++;
        task.lastRun = execution.timestamp;
        task.nextRun = this.getNextRunTime(task.schedule)?.toISOString();
        task.consecutiveFailCount = 0;
        taskLogger.info('Task completed', { execution });
      } else {
        throw new Error('ai_chat tool not found');
      }
    } catch (error: unknown) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : String(error);
      task.runCount++;
      task.failCount++;
      const cfc = (task.consecutiveFailCount ?? 0) + 1;
      task.consecutiveFailCount = cfc;
      if (cfc >= 3) {
        task.enabled = false;
        this.stopCronJob(taskId);
        taskLogger.warn('Task disabled after 3 consecutive failures', { taskId, name: task.name });
      }

      taskLogger.error('Scheduled task execution failed', error, {
        taskId,
        runId,
      });
    } finally {
      execution.duration = Date.now() - startTime;
      this.executions.push(execution);

      if (this.executions.length > this.maxHistorySize) {
        this.executions = this.executions.slice(-this.maxHistorySize);
      }

      this.saveState();
    }
  }

  createTask(
    taskData: Omit<ScheduledTask, 'id' | 'createdAt' | 'runCount' | 'failCount'>,
  ): ScheduledTask {
    if (!cron.validate(taskData.schedule)) {
      throw new Error(`Invalid cron schedule: ${taskData.schedule}`);
    }

    const task: ScheduledTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString(),
      runCount: 0,
      failCount: 0,
      ...taskData,
    };

    this.tasks.set(task.id, task);

    if (task.enabled && config.scheduler?.enabled !== false) {
      this.startCronJob(task);
    }

    this.saveState();
    this.logger.info('Task created', { taskId: task.id, name: task.name });

    return task;
  }

  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  updateTask(taskId: string, updates: Partial<ScheduledTask>): ScheduledTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const wasEnabled = task.enabled;
    const oldSchedule = task.schedule;

    Object.assign(task, updates);

    if (updates.schedule && updates.schedule !== oldSchedule) {
      if (!cron.validate(updates.schedule)) {
        throw new Error(`Invalid cron schedule: ${updates.schedule}`);
      }

      if (wasEnabled) {
        this.stopCronJob(taskId);
        this.startCronJob(task);
      }
    }

    if (updates.enabled !== undefined && updates.enabled !== wasEnabled) {
      if (updates.enabled) {
        this.startCronJob(task);
      } else {
        this.stopCronJob(taskId);
      }
    }

    this.saveState();
    this.logger.info('Task updated', { taskId, updates });

    return task;
  }

  deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    this.stopCronJob(taskId);
    this.tasks.delete(taskId);
    this.saveState();

    this.logger.info('Task deleted', { taskId });
    return true;
  }

  pauseTask(taskId: string): boolean {
    return this.updateTask(taskId, { enabled: false }) !== undefined;
  }

  resumeTask(taskId: string): boolean {
    return this.updateTask(taskId, { enabled: true }) !== undefined;
  }

  async executeNow(taskId: string): Promise<void> {
    await this.executeTask(taskId);
  }

  getExecutionHistory(taskId?: string, limit: number = 50): TaskExecution[] {
    let history = this.executions;

    if (taskId) {
      history = history.filter((e) => e.taskId === taskId);
    }

    return history.slice(-limit).reverse();
  }

  getStats(): {
    totalTasks: number;
    enabledTasks: number;
    disabledTasks: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
  } {
    const tasks = Array.from(this.tasks.values());

    return {
      totalTasks: tasks.length,
      enabledTasks: tasks.filter((t) => t.enabled).length,
      disabledTasks: tasks.filter((t) => !t.enabled).length,
      totalExecutions: this.executions.length,
      successfulExecutions: this.executions.filter((e) => e.status === 'success').length,
      failedExecutions: this.executions.filter((e) => e.status === 'failed').length,
    };
  }

  shutdown(): void {
    this.logger.info('Shutting down scheduler');

    this.cronJobs.forEach((job, taskId) => {
      job.stop();
      this.logger.info('Stopped cron job', { taskId });
    });

    this.cronJobs.clear();
    this.saveState();
  }
}

export const schedulerManager = new SchedulerManager();

export const schedulerTools = [
  {
    name: 'scheduler_task',
    description:
      'Manage scheduled tasks — create, list, get, update, delete, pause, resume, or execute immediately. ' +
      "Use action to select the operation. Required params depend on action: 'create' needs name/schedule/agentTask; " +
      "'list' accepts onlyEnabled; 'get'/'delete'/'pause'/'resume'/'execute' need taskId; 'update' needs taskId + optional fields.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'get', 'update', 'delete', 'pause', 'resume', 'execute'],
          description: 'Operation to perform',
        },
        taskId: {
          type: 'string',
          description: 'Task ID — required for get, update, delete, pause, resume, execute',
        },
        name: {
          type: 'string',
          description: 'Meaningful name for the task — required for create, optional for update',
        },
        schedule: {
          type: 'string',
          description:
            "Cron format schedule (ex: '0 9 * * *' = every day at 09:00, '*/5 * * * *' = every 5 minutes) — required for create, optional for update",
        },
        agentTask: {
          type: 'string',
          description:
            'Description of the task the AI Agent will run — required for create, optional for update',
        },
        enabled: {
          type: 'boolean',
          description:
            'Should the task be active? (default: true for create) — optional for create/update',
        },
        context: {
          type: 'object',
          description: 'Additional context information for the task — optional',
        },
        onlyEnabled: {
          type: 'boolean',
          description: 'Show only active tasks — optional, applies to list action (default: false)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          action: z.enum(['create', 'list', 'get', 'update', 'delete', 'pause', 'resume', 'execute']),
          taskId: z.string().optional(),
          name: z.string().optional(),
          schedule: z.string().optional(),
          agentTask: z.string().optional(),
          enabled: z.boolean().optional(),
          context: z.record(z.string(), z.unknown()).optional(),
          onlyEnabled: z.boolean().optional(),
        })
        .safeParse(args);

      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: `❌ Invalid parameters: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { action, taskId, name, schedule, agentTask, enabled, context, onlyEnabled } =
        parsed.data;

      switch (action) {
        case 'create': {
          if (!name || !schedule || !agentTask) {
            return {
              content: [
                {
                  type: 'text',
                  text: '❌ create action requires: name, schedule, agentTask',
                },
              ],
              isError: true,
            };
          }

          if (!config.scheduler?.enabled) {
            return {
              content: [
                {
                  type: 'text',
                  text: "❌ Scheduler is disabled. In config.yaml make 'scheduler.enabled: true'.",
                },
              ],
              isError: true,
            };
          }

          const task = schedulerManager.createTask({
            name,
            schedule,
            agentTask,
            enabled: enabled ?? true,
            context,
          });

          const nextRun = task.nextRun ? new Date(task.nextRun).toLocaleString() : 'N/A';

          return {
            content: [
              {
                type: 'text',
                text:
                  `✅ Scheduled task created!\n` +
                  `**ID:** ${task.id}\n` +
                  `**Name:** ${task.name}\n` +
                  `**Schedule:** ${task.schedule}\n` +
                  `**Agent Task:** ${task.agentTask}\n` +
                  `**Status:** ${task.enabled ? '✅ Active' : '⏸️ Inactive'}\n` +
                  `**Next Run:** ${nextRun}\n` +
                  `**Created at:** ${new Date(task.createdAt).toLocaleString()}`,
              },
            ],
          };
        }

        case 'list': {
          let tasks = schedulerManager.listTasks();

          if (onlyEnabled) {
            tasks = tasks.filter((t) => t.enabled);
          }

          if (tasks.length === 0) {
            return {
              content: [{ type: 'text', text: 'There are no scheduled tasks yet.' }],
            };
          }

          const taskList = tasks
            .map((task) => {
              const status = task.enabled ? '✅ Active' : '⏸️ Inactive';
              const nextRun = task.nextRun ? new Date(task.nextRun).toLocaleString() : 'N/A';
              const lastRun = task.lastRun
                ? new Date(task.lastRun).toLocaleString()
                : 'not run yet';

              return (
                `### ${task.name}\n` +
                `- **ID:** ${task.id}\n` +
                `- **Status:** ${status}\n` +
                `- **Schedule:** ${task.schedule}\n` +
                `- **Agent Task:** ${task.agentTask}\n` +
                `- **Run Count:** ${task.runCount} (${task.failCount} error(s))\n` +
                `- **Last Run:** ${lastRun}\n` +
                `- **Next Run:** ${nextRun}\n`
              );
            })
            .join('\n');

          const stats = schedulerManager.getStats();

          return {
            content: [
              {
                type: 'text',
                text:
                  `# Scheduled Tasks\n` +
                  `**Total:** ${stats.totalTasks} (${stats.enabledTasks} active, ${stats.disabledTasks} inactive)\n\n` +
                  taskList,
              },
            ],
          };
        }

        case 'get': {
          if (!taskId) {
            return {
              content: [{ type: 'text', text: '❌ get action requires: taskId' }],
              isError: true,
            };
          }

          const task = schedulerManager.getTask(taskId);

          if (!task) {
            return {
              content: [{ type: 'text', text: `❌ Task not found: ${taskId}` }],
              isError: true,
            };
          }

          const status = task.enabled ? '✅ Active' : '⏸️ Inactive';
          const nextRun = task.nextRun ? new Date(task.nextRun).toLocaleString() : 'N/A';
          const lastRun = task.lastRun
            ? new Date(task.lastRun).toLocaleString()
            : 'not run yet';

          const history = schedulerManager.getExecutionHistory(taskId, 5);
          const recentExecutions =
            history.length > 0
              ? history
                  .map(
                    (e) =>
                      `- ${new Date(e.timestamp).toLocaleString()}: ${e.status === 'success' ? '✅' : '❌'} (${e.duration}ms)`,
                  )
                  .join('\n')
              : 'Not run yet';

          return {
            content: [
              {
                type: 'text',
                text:
                  `# Task Details\n` +
                  `**ID:** ${task.id}\n` +
                  `**Name:** ${task.name}\n` +
                  `**Status:** ${status}\n` +
                  `**Schedule:** ${task.schedule}\n` +
                  `**Agent Task:** ${task.agentTask}\n\n` +
                  `## Statistics\n` +
                  `- Total Work: ${task.runCount}\n` +
                  `- Successful: ${task.runCount - task.failCount}\n` +
                  `- Incorrect: ${task.failCount}\n` +
                  `- Latest Work: ${lastRun}\n` +
                  `- Next Work: ${nextRun}\n` +
                  `- Creation: ${new Date(task.createdAt).toLocaleString()}\n\n` +
                  `## Last 5 Runs\n${recentExecutions}`,
              },
            ],
          };
        }

        case 'update': {
          if (!taskId) {
            return {
              content: [{ type: 'text', text: '❌ update action requires: taskId' }],
              isError: true,
            };
          }

          const updates: Partial<ScheduledTask> = {};
          if (name !== undefined) updates.name = name;
          if (schedule !== undefined) updates.schedule = schedule;
          if (agentTask !== undefined) updates.agentTask = agentTask;
          if (enabled !== undefined) updates.enabled = enabled;
          if (context !== undefined) updates.context = context;

          try {
            const task = schedulerManager.updateTask(taskId, updates);

            return {
              content: [
                {
                  type: 'text',
                  text:
                    `✅ Quest updated!\n` +
                    `**ID:** ${task.id}\n` +
                    `**Name:** ${task.name}\n` +
                    `**Schedule:** ${task.schedule}\n` +
                    `**Status:** ${task.enabled ? '✅ Active' : '⏸️ Inactive'}\n` +
                    `**Next Run:** ${task.nextRun ? new Date(task.nextRun).toLocaleString() : 'N/A'}`,
                },
              ],
            };
          } catch (error: unknown) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Update error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }

        case 'delete': {
          if (!taskId) {
            return {
              content: [{ type: 'text', text: '❌ delete action requires: taskId' }],
              isError: true,
            };
          }

          const success = schedulerManager.deleteTask(taskId);

          if (!success) {
            return {
              content: [{ type: 'text', text: `❌ Task not found: ${taskId}` }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text', text: `✅ Task deleted: ${taskId}` }],
          };
        }

        case 'pause': {
          if (!taskId) {
            return {
              content: [{ type: 'text', text: '❌ pause action requires: taskId' }],
              isError: true,
            };
          }

          try {
            schedulerManager.pauseTask(taskId);

            return {
              content: [{ type: 'text', text: `⏸️ Mission paused: ${taskId}` }],
            };
          } catch (error: unknown) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }

        case 'resume': {
          if (!taskId) {
            return {
              content: [{ type: 'text', text: '❌ resume action requires: taskId' }],
              isError: true,
            };
          }

          try {
            schedulerManager.resumeTask(taskId);
            const task = schedulerManager.getTask(taskId);

            return {
              content: [
                {
                  type: 'text',
                  text:
                    `▶️ Task resumed: ${taskId}\n` +
                    `**Next Run:** ${task?.nextRun ? new Date(task.nextRun).toLocaleString() : 'N/A'}`,
                },
              ],
            };
          } catch (error: unknown) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }

        case 'execute': {
          if (!taskId) {
            return {
              content: [{ type: 'text', text: '❌ execute action requires: taskId' }],
              isError: true,
            };
          }

          const task = schedulerManager.getTask(taskId);
          if (!task) {
            return {
              content: [{ type: 'text', text: `❌ Task not found: ${taskId}` }],
              isError: true,
            };
          }

          try {
            await schedulerManager.executeNow(taskId);

            const history = schedulerManager.getExecutionHistory(taskId, 1);
            const lastExecution = history[0];

            if (lastExecution && lastExecution.status === 'success') {
              return {
                content: [
                  {
                    type: 'text',
                    text:
                      `✅ Task ran successfully!\n` +
                      `**Duty:** ${task.name}\n` +
                      `**Duration:** ${lastExecution.duration}ms\n` +
                      `**Conclusion:** ${lastExecution.result || 'completed'}`,
                  },
                ],
              };
            } else if (lastExecution && lastExecution.status === 'failed') {
              return {
                content: [
                  {
                    type: 'text',
                    text:
                      `❌ Failed to run task!\n` +
                      `**Duty:** ${task.name}\n` +
                      `**Error:** ${lastExecution.error || 'Unknown error'}`,
                  },
                ],
                isError: true,
              };
            }

            return {
              content: [{ type: 'text', text: `✅ Task run: ${task.name}` }],
            };
          } catch (error: unknown) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Operation error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      }
    },
  },
  {
    name: 'scheduler_info',
    description:
      "View scheduler history or statistics. Use action: 'history' for execution history (optional taskId and limit), 'stats' for aggregate statistics.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['history', 'stats'],
          description: "Operation to perform: 'history' or 'stats'",
        },
        taskId: {
          type: 'string',
          description:
            'Mission ID — optional for history (all missions if not given), not used for stats',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records — optional for history (default: 50)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          action: z.enum(['history', 'stats']),
          taskId: z.string().optional(),
          limit: z.number().optional().default(50),
        })
        .safeParse(args);

      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: `❌ Invalid parameters: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { action, taskId, limit = 50 } = parsed.data;

      switch (action) {
        case 'history': {
          const history = schedulerManager.getExecutionHistory(taskId, limit);

          if (history.length === 0) {
            return {
              content: [{ type: 'text', text: 'No operating history yet.' }],
            };
          }

          const historyText = history
            .map((e) => {
              const status = e.status === 'success' ? '✅' : '❌';
              const task = schedulerManager.getTask(e.taskId);
              const taskName = task?.name || e.taskId;

              return (
                `### ${new Date(e.timestamp).toLocaleString()} ${status}\n` +
                `- **Duty:** ${taskName}\n` +
                `- **Status:** ${e.status}\n` +
                `- **Duration:** ${e.duration}ms\n` +
                (e.error ? `- **Error:** ${e.error}\n` : '')
              );
            })
            .join('\n');

          return {
            content: [
              {
                type: 'text',
                text: `# Run History\n**Total:** ${history.length} record(s)\n\n` + historyText,
              },
            ],
          };
        }

        case 'stats': {
          const stats = schedulerManager.getStats();

          const successRate =
            stats.totalExecutions > 0
              ? ((stats.successfulExecutions / stats.totalExecutions) * 100).toFixed(1)
              : '0';

          return {
            content: [
              {
                type: 'text',
                text:
                  `# Scheduler Statistics\n` +
                  `## Missions\n` +
                  `- Total: ${stats.totalTasks}\n` +
                  `- Active: ${stats.enabledTasks}\n` +
                  `- Inactive: ${stats.disabledTasks}\n\n` +
                  `## Runs\n` +
                  `- Total: ${stats.totalExecutions}\n` +
                  `- Successful: ${stats.successfulExecutions}\n` +
                  `- Incorrect: ${stats.failedExecutions}\n` +
                  `- Success Rate: ${successRate}%`,
              },
            ],
          };
        }
      }
    },
  },
];
