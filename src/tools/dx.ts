import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

function toolTemplate(name: string, description: string): string {
  return `import { z } from 'zod';

export const ${name}Tools = [
  {
    name: '${name}',
    description: '${description}',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ content: [{ type: 'text', text: 'hello from ${name}' }] }),
  },
];
`;
}

export const dxTools = [
  {
    name: 'dx_toolScaffold',
    description:
      "Developer experience tools. action='scaffold' generates TypeScript tool skeleton (optionally writes to file). action='tips' returns hot-reload and development tips.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['scaffold', 'tips'] },
        name: { type: 'string', description: 'Tool name (required for scaffold)' },
        description: { type: 'string', description: 'Tool description (required for scaffold)' },
        outputPath: { type: 'string', description: 'Optional output path (scaffold only)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, name, description, outputPath } = z
        .object({
          action: z.enum(['scaffold', 'tips']),
          name: z.string().optional(),
          description: z.string().optional(),
          outputPath: z.string().optional(),
        })
        .parse(args);

      switch (action) {
        case 'scaffold': {
          const { name: toolName, description: toolDescription } = z
            .object({ name: z.string(), description: z.string() })
            .parse({ name, description });
          const content = toolTemplate(toolName, toolDescription);
          if (outputPath) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, content, 'utf8');
          }
          return { content: [{ type: 'text', text: content }] };
        }
        case 'tips': {
          return {
            content: [
              {
                type: 'text',
                text:
                  'Development tips:\\n' +
                  '- `npm run dev` (ts-node/esm) fast iteration.\\n' +
                  '- `npm run test:watch` for Jest.\\n' +
                  '- When adding a tool, generate a skeleton with `dx_toolScaffold` and add it to `src/tools/index`.\\n',
              },
            ],
          };
        }
      }
    },
  },
];
