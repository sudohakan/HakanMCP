import { z } from 'zod';
import fs from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

export const envTools = [
  {
    name: 'env',
    description:
      'Environment variable operations. Actions: getVar, setVar, deleteVar, loadFile, saveFile, listVars.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['getVar', 'setVar', 'deleteVar', 'loadFile', 'saveFile', 'listVars'],
          description: 'Operation to perform',
        },
        key: { type: 'string', description: 'Variable key (required for getVar, setVar, deleteVar)' },
        value: { type: 'string', description: 'Variable value (required for setVar)' },
        path: { type: 'string', description: 'File path (used for loadFile, saveFile; default: .env)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, key, value, path } = z
        .object({
          action: z.enum(['getVar', 'setVar', 'deleteVar', 'loadFile', 'saveFile', 'listVars']),
          key: z.string().optional(),
          value: z.string().optional(),
          path: z.string().optional(),
        })
        .parse(args);

      switch (action) {
        case 'getVar': {
          if (!key) throw new Error('key is required for action=getVar');
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

        case 'setVar': {
          if (!key) throw new Error('key is required for action=setVar');
          if (value === undefined) throw new Error('value is required for action=setVar');
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

        case 'deleteVar': {
          if (!key) throw new Error('key is required for action=deleteVar');
          delete process.env[key];
          return {
            content: [
              {
                type: 'text',
                text: `✓ Deleted environment variable: ${key}`,
              },
            ],
          };
        }

        case 'loadFile': {
          const filePath = path || '.env';
          dotenvConfig({ path: filePath });
          return {
            content: [
              {
                type: 'text',
                text: `✓ Loaded environment variables from: ${filePath}`,
              },
            ],
          };
        }

        case 'saveFile': {
          const filePath = path || '.env';
          const content = Object.entries(process.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
          await fs.promises.writeFile(filePath, content, 'utf8');
          return {
            content: [
              {
                type: 'text',
                text: `✓ Saved environment variables to: ${filePath}`,
              },
            ],
          };
        }

        case 'listVars': {
          const SENSITIVE_SUFFIXES = ['_KEY', '_TOKEN', '_SECRET', '_PASSWORD', '_CREDENTIAL'];
          const maskValue = (k: string, v: string | undefined): string | undefined => {
            if (!v) return v;
            const upperKey = k.toUpperCase();
            if (SENSITIVE_SUFFIXES.some((suffix) => upperKey.endsWith(suffix))) {
              return v.length > 4 ? v.slice(0, 4) + '****' : '****';
            }
            return v;
          };
          const vars = Object.entries(process.env).map(([k, v]) => ({
            key: k,
            value: maskValue(k, v),
          }));
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ count: vars.length, variables: vars }, null, 2),
              },
            ],
          };
        }
      }
    },
  },
];
