import { z } from 'zod';
import fs from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

const envVarSchema = z.object({
  action: z.enum(['get', 'set', 'delete']),
  key: z.string(),
  value: z.string().optional(),
});

const envFileSchema = z.object({
  action: z.enum(['load', 'save']),
  path: z.string().default('.env'),
});

export const envTools = [
  {
    name: 'env_var',
    description: 'Get, set, or delete an environment variable. action=get reads it, action=set writes it (value required), action=delete removes it.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'delete'] },
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['action', 'key'],
    },
    handler: async (args: unknown) => {
      const { action, key, value } = envVarSchema.parse(args);

      if (action === 'get') {
        const val = process.env[key];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ key, value: val || null }, null, 2),
            },
          ],
        };
      }

      if (action === 'set') {
        if (value === undefined) {
          throw new Error('value is required for action=set');
        }
        process.env[key] = value;
        return {
          content: [
            {
              type: 'text',
              text: `✓ Environment variable set: ${key} = ${value}`,
            },
          ],
        };
      }

      delete process.env[key];
      return {
        content: [
          {
            type: 'text',
            text: `✓ Deleted environment variable: ${key}`,
          },
        ],
      };
    },
  },
  {
    name: 'env_file',
    description: 'Load environment variables from a .env file into the process, or save current process env vars to a file. action=load reads the file, action=save writes to it. path defaults to .env.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['load', 'save'] },
        path: { type: 'string' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, path } = envFileSchema.parse(args);

      if (action === 'load') {
        dotenvConfig({ path });
        return {
          content: [
            {
              type: 'text',
              text: `✓ Loaded environment variables from: ${path}`,
            },
          ],
        };
      }

      const content = Object.entries(process.env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      await fs.promises.writeFile(path, content, 'utf8');
      return {
        content: [
          {
            type: 'text',
            text: `✓ Saved environment variables to: ${path}`,
          },
        ],
      };
    },
  },
  {
    name: 'env_listVars',
    description: 'Lists all environment variables (sensitive values are masked).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const SENSITIVE_SUFFIXES = ['_KEY', '_TOKEN', '_SECRET', '_PASSWORD', '_CREDENTIAL'];
      const maskValue = (key: string, value: string | undefined): string | undefined => {
        if (!value) return value;
        const upperKey = key.toUpperCase();
        if (SENSITIVE_SUFFIXES.some((suffix) => upperKey.endsWith(suffix))) {
          return value.length > 4 ? value.slice(0, 4) + '****' : '****';
        }
        return value;
      };
      const vars = Object.entries(process.env).map(([key, value]) => ({
        key,
        value: maskValue(key, value),
      }));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: vars.length, variables: vars }, null, 2),
          },
        ],
      };
    },
  },
];
