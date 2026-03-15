import { z } from 'zod';
import Handlebars from 'handlebars';
import fs from 'node:fs';

export const templateTools = [
  {
    name: 'compile_template',
    description:
      'Renders a Handlebars template. Provide template (inline string) or templatePath (file path) with data object. Optionally write result to outputPath.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string' },
        templatePath: { type: 'string' },
        data: { type: 'object' },
        outputPath: { type: 'string' },
      },
      required: ['data'],
    },
    handler: async (args: unknown) => {
      const { template, templatePath, data, outputPath } = z
        .object({
          template: z.string().optional(),
          templatePath: z.string().optional(),
          data: z.record(z.string(), z.any()),
          outputPath: z.string().optional(),
        })
        .refine((val) => val.template !== undefined || val.templatePath !== undefined, {
          message: "At least one of 'template' or 'templatePath' must be provided.",
        })
        .parse(args);

      const templateStr = templatePath ? fs.readFileSync(templatePath, 'utf8') : template!;
      const compiled = Handlebars.compile(templateStr, {});
      const result = compiled(data);

      if (outputPath) {
        fs.writeFileSync(outputPath, result, 'utf8');
        const source = templatePath ?? 'inline';
        return {
          content: [
            {
              type: 'text',
              text: `Template compiled: ${source} → ${outputPath}\n\n${result}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    },
  },
];
