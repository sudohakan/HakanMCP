import { z } from 'zod';
import { backupService } from '../services/backupService.js';
import { createJsonResponse, createTextResponse } from '../utils/common.js';

export const backupTools = [
  {
    name: 'backup',
    description:
      'Backup operations: create a ZIP backup, list backups, show stats, start/stop automatic service, or delete old backups.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'stats', 'start', 'stop', 'deleteOld'],
          description: 'Action to perform',
        },
        olderThanHours: {
          type: 'number',
          description: 'Required for deleteOld: delete backups older than this many hours (ex: 48)',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, olderThanHours } = z
        .object({
          action: z.enum(['create', 'list', 'stats', 'start', 'stop', 'deleteOld']),
          olderThanHours: z.number().positive().optional(),
        })
        .parse(args);

      switch (action) {
        case 'create': {
          const backupPath = await backupService.createBackup({ skipIntervalCheck: true });
          return createTextResponse(`✓ Backup created: ${backupPath}`);
        }

        case 'list': {
          const backups = backupService.listBackups();
          return createJsonResponse({
            count: backups.length,
            backups: backups.map((b) => ({
              path: b.path,
              created: new Date(b.created).toISOString(),
              sizeMB: b.sizeMB,
              ageHours: ((Date.now() - b.created) / (1000 * 60 * 60)).toFixed(1),
            })),
          });
        }

        case 'stats': {
          const stats = backupService.getStats();
          return createJsonResponse(stats);
        }

        case 'start': {
          backupService.start();
          return createTextResponse('✓ Automatic backup service started');
        }

        case 'stop': {
          backupService.stop();
          return createTextResponse('✓ Automatic backup service stopped');
        }

        case 'deleteOld': {
          if (olderThanHours === undefined) {
            return createTextResponse('❌ olderThanHours is required for deleteOld action');
          }
          const backups = backupService.listBackups();
          const cutoffTime = Date.now() - olderThanHours * 60 * 60 * 1000;
          const oldBackups = backups.filter((b) => b.created < cutoffTime);
          const fs = await import('node:fs');
          let deleted = 0;
          for (const backup of oldBackups) {
            try {
              fs.unlinkSync(backup.path);
              deleted++;
            } catch { /* empty */
            }
          }
          return createTextResponse(
            `✓ Deleted ${deleted} backup(s) older than ${olderThanHours} hours`,
          );
        }
      }
    },
  },

  {
    name: 'backup_restore',
    description: 'Restores from the specified backup.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        backupPath: {
          type: 'string',
          description: 'Full path to the ZIP file to restore',
        },
        targetDir: {
          type: 'string',
          description: 'Directory to restore (optional, default: source directory)',
        },
      },
      required: ['backupPath'],
    },
    handler: async (args: unknown) => {
      const { backupPath, targetDir } = z
        .object({
          backupPath: z.string(),
          targetDir: z.string().optional(),
        })
        .parse(args);

      await backupService.restoreBackup(backupPath, targetDir);
      return createTextResponse(`✓ Backup restored from: ${backupPath}`);
    },
  },
];
