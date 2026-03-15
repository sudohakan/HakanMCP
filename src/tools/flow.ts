import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { PROJECT_ROOT } from '../utils/projectRoot.js';
import { getFlowHistory, loadFlow, recordFlowHistory, runFlowFile } from '../flows/runner.js';
import { maskConnection, upsertConnection } from '../utils/connections.js';

export const flowTools = [
  {
    name: 'flow_validate',
    description: 'Validate a flow/recipe JSON file (trigger/steps/action schema).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Flow JSON path (ex: recipes/health-sync.json)',
        },
      },
      required: ['path'],
    },
    handler: async (args: unknown) => {
      const { path } = z
        .object({
          path: z.string(),
        })
        .parse(args);

      try {
        const flow = loadFlow(path);
        return {
          content: [
            {
              type: 'text',
              text:
                `✅ Flow verified\\n` +
                `- name: ${flow.name}\n` +
                `- steps: ${flow.steps.length}\n` +
                (flow.trigger ? `- trigger: ${flow.trigger.type}\n` : ''),
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Validation error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'flow_run',
    description:
      'Run a flow/recipe JSON file (actions: log, monitor_healthCheck, syncPeerRepo, http_request + connectionId).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Flow JSON path (ex: recipes/health-sync.json)',
        },
      },
      required: ['path'],
    },
    handler: async (args: unknown) => {
      const { path: filePath } = z
        .object({
          path: z.string(),
        })
        .parse(args);

      try {
        const result = await runFlowFile(filePath);
        await recordFlowHistory({
          name: path.basename(filePath),
          path: filePath,
          timestamp: new Date().toISOString(),
          success: result.success,
          logs: result.logs,
        });
        logger.info('flow_run result', { path: filePath, result });
        const header = result.success ? '✅ Flow completed' : '⚠️ Flow stopped with an error';
        return {
          content: [
            {
              type: 'text',
              text: `${header}\n\n${result.logs.join('\n')}`,
            },
          ],
          isError: !result.success,
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Execution error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'flow_history',
    description: 'List last flow run history.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum records to show',
        },
      },
    },
    handler: async (args: unknown) => {
      const { limit = 10 } = z
        .object({
          limit: z.number().optional(),
        })
        .parse(args || {});

      const history = await getFlowHistory(limit);
      if (history.length === 0) {
        return { content: [{ type: 'text', text: 'No registration yet.' }] };
      }

      const lines = history.map(
        (h) =>
          `- ${h.timestamp} | ${h.name} | ${h.success ? '✅' : '❌'} | ${
            h.logs[h.logs.length - 1] || ''
          }`,
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  },

  {
    name: 'flow_replay',
    description: 'Rerun the last (or last for the given path) flow record.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'If you want to select the last record for a specific flow file, provide path.',
        },
      },
    },
    handler: async (args: unknown) => {
      const { path: filePath } = z
        .object({
          path: z.string().optional(),
        })
        .parse(args || {});

      const history = await getFlowHistory(20);
      const target = filePath
        ? history.find((h) => h.path === filePath)
        : history.length > 0
          ? history[0]
          : undefined;

      if (!target?.path) {
        return {
          content: [{ type: 'text', text: '❌ No suitable history record found.' }],
          isError: true,
        };
      }

      if (!fs.existsSync(target.path)) {
        return {
          content: [{ type: 'text', text: `❌ Flow file not found: \${target.path}` }],
          isError: true,
        };
      }

      const result = await runFlowFile(target.path);
      await recordFlowHistory({
        name: path.basename(target.path),
        path: target.path,
        timestamp: new Date().toISOString(),
        success: result.success,
        logs: result.logs,
      });

      const header = result.success ? '✅ Replay completed' : '⚠️ Replay stopped with an error';
      return {
        content: [{ type: 'text', text: `${header}\n\n${result.logs.join('\n')}` }],
        isError: !result.success,
      };
    },
  },

  {
    name: 'flow_version',
    description: 'Flow version operations: save a version snapshot, list versions, or restore a version.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'list', 'restore'],
          description: 'Action to perform',
        },
        path: { type: 'string', description: 'Flow JSON path' },
        label: { type: 'string', description: 'Optional label for the version (save only)' },
        versionFile: {
          type: 'string',
          description: 'Version file name to restore (restore only, see list action)',
        },
        limit: { type: 'number', description: 'Max versions to show (list only)', minimum: 1 },
      },
      required: ['action', 'path'],
    },
    handler: async (args: unknown) => {
      const { action, path: filePath, label, versionFile, limit = 20 } = z
        .object({
          action: z.enum(['save', 'list', 'restore']),
          path: z.string(),
          label: z.string().optional(),
          versionFile: z.string().optional(),
          limit: z.number().optional(),
        })
        .parse(args);

      const base = path.basename(filePath, path.extname(filePath));
      const versionDir =
        process.env.FLOW_VERSION_DIR || path.join(PROJECT_ROOT, 'logs', 'flows', 'versions', base);

      switch (action) {
        case 'save': {
          if (!fs.existsSync(filePath)) {
            return {
              content: [{ type: 'text', text: `❌ File not found: ${filePath}` }],
              isError: true,
            };
          }
          fs.mkdirSync(versionDir, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const suffix = label ? `-${label}` : '';
          const target = path.join(versionDir, `${base}-${ts}${suffix}.json`);
          fs.copyFileSync(filePath, target);
          return {
            content: [{ type: 'text', text: `✅ Version saved: ${target}` }],
          };
        }

        case 'list': {
          if (!fs.existsSync(versionDir)) {
            return { content: [{ type: 'text', text: 'There is no version record.' }] };
          }
          const files = fs
            .readdirSync(versionDir)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .reverse()
            .slice(0, limit);
          const lines = files.map((f) => `- ${f}`);
          return {
            content: [{ type: 'text', text: lines.join('\n') || 'There is no version record.' }],
          };
        }

        case 'restore': {
          if (!versionFile) {
            return {
              content: [{ type: 'text', text: '❌ versionFile is required for restore action' }],
              isError: true,
            };
          }
          const source = path.join(versionDir, versionFile);
          if (!fs.existsSync(source)) {
            return {
              content: [{ type: 'text', text: `❌ Version not found: \${source}` }],
              isError: true,
            };
          }
          fs.copyFileSync(source, filePath);
          return { content: [{ type: 'text', text: `✅ Restored: ${filePath}` }] };
        }
      }
    },
  },

  {
    name: 'connection',
    description:
      'Connection operations: save a connection, list all connections, get a single connection, or delete a connection.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'list', 'get', 'delete'],
          description: 'Action to perform',
        },
        id: {
          type: 'string',
          description: 'Connection ID (save: optional, will be generated; get/delete: required)',
        },
        name: { type: 'string', description: 'Display name (save only)' },
        type: {
          type: 'string',
          description: 'Ex: slack_webhook, discord_webhook, api_key (save only)',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags (save only)' },
        config: {
          type: 'object',
          description: 'URL/token/apiKey/headerName etc. (save only)',
        },
        includeSecrets: {
          type: 'boolean',
          description: 'Include secrets in response (get only)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, id, name, type, tags, config, includeSecrets } = z
        .object({
          action: z.enum(['save', 'list', 'get', 'delete']),
          id: z.string().optional(),
          name: z.string().optional(),
          type: z.string().optional(),
          tags: z.array(z.string()).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          includeSecrets: z.boolean().optional(),
        })
        .parse(args);

      switch (action) {
        case 'save': {
          if (!name) throw new Error('name is required for save action');
          if (!type) throw new Error('type is required for save action');
          if (!config) throw new Error('config is required for save action');
          const connId = id || `conn-${Date.now()}`;
          const stored = upsertConnection({ id: connId, name, type, tags, config });
          return {
            content: [
              {
                type: 'text',
                text: `✅ Connection saved: ${stored.id}\n${JSON.stringify(maskConnection(stored), null, 2)}`,
              },
            ],
          };
        }

        case 'list': {
          const list = (await import('../utils/connections.js')).listConnections();
          if (list.length === 0) return { content: [{ type: 'text', text: 'No record.' }] };
          const masked = list.map((c) => maskConnection(c));
          return { content: [{ type: 'text', text: JSON.stringify(masked, null, 2) }] };
        }

        case 'get': {
          if (!id) throw new Error('id is required for get action');
          const { getConnection } = await import('../utils/connections.js');
          const conn = getConnection(id);
          if (!conn) return { content: [{ type: 'text', text: 'Not found.' }], isError: true };
          const payload = includeSecrets ? conn : maskConnection(conn);
          return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
        }

        case 'delete': {
          if (!id) throw new Error('id is required for delete action');
          const { deleteConnection } = await import('../utils/connections.js');
          const ok = deleteConnection(id);
          return {
            content: [{ type: 'text', text: ok ? '✅ Deleted' : 'No record found' }],
            isError: !ok,
          };
        }
      }
    },
  },
];
