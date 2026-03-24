import { z } from 'zod';
import yaml from 'js-yaml';
import fs from 'node:fs';
import { parseString } from 'xml2js';
import { parse as csvParse } from 'csv-parse/sync';
import { promisify } from 'node:util';

const parseXml = promisify(parseString);

export const parserTools = [
  {
    name: 'parse',
    description: 'Parse and convert operations. Actions: parse (yaml/json/xml/csv content), convertFile (json/yaml file conversion).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['parse', 'convertFile'],
          description: 'Operation to perform',
        },
        format: { type: 'string', enum: ['yaml', 'json', 'xml', 'csv'], description: 'Format to parse (parse action)' },
        content: { type: 'string', description: 'Content string to parse (parse action)' },
        delimiter: { type: 'string', description: 'CSV delimiter (parse action, default: ,)' },
        from: { type: 'string', enum: ['json', 'yaml'], description: 'Source format (convertFile action)' },
        to: { type: 'string', enum: ['json', 'yaml'], description: 'Target format (convertFile action)' },
        inputPath: { type: 'string', description: 'Input file path (convertFile action)' },
        outputPath: { type: 'string', description: 'Output file path (convertFile action)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, format, content, delimiter, from, to, inputPath, outputPath } = z
        .object({
          action: z.enum(['parse', 'convertFile']),
          format: z.enum(['yaml', 'json', 'xml', 'csv']).optional(),
          content: z.string().optional(),
          delimiter: z.string().optional(),
          from: z.enum(['json', 'yaml']).optional(),
          to: z.enum(['json', 'yaml']).optional(),
          inputPath: z.string().optional(),
          outputPath: z.string().optional(),
        })
        .parse(args);

      switch (action) {
        case 'parse': {
          if (!format) throw new Error('format is required for action=parse');
          if (!content) throw new Error('content is required for action=parse');

          switch (format) {
            case 'yaml': {
              const parsed = yaml.load(content);
              return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
            }
            case 'json': {
              const parsed = JSON.parse(content);
              return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
            }
            case 'xml': {
              const parsed = await parseXml(content);
              return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
            }
            case 'csv': {
              const records = csvParse(content, {
                columns: true,
                skip_empty_lines: true,
                delimiter: delimiter ?? ',',
              });
              return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
            }
          }
          break;
        }

        case 'convertFile': {
          if (!from) throw new Error('from is required for action=convertFile');
          if (!to) throw new Error('to is required for action=convertFile');
          if (!inputPath) throw new Error('inputPath is required for action=convertFile');
          if (!outputPath) throw new Error('outputPath is required for action=convertFile');

          switch (`${from}_to_${to}`) {
            case 'yaml_to_json': {
              const yamlContent = fs.readFileSync(inputPath, 'utf8');
              const parsed = yaml.load(yamlContent);
              fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), 'utf8');
              return {
                content: [{ type: 'text', text: `✓ YAML converted to JSON: ${inputPath} → ${outputPath}` }],
              };
            }
            case 'json_to_yaml': {
              const jsonContent = fs.readFileSync(inputPath, 'utf8');
              const parsed = JSON.parse(jsonContent);
              const yamlContent = yaml.dump(parsed);
              fs.writeFileSync(outputPath, yamlContent, 'utf8');
              return {
                content: [{ type: 'text', text: `✓ JSON converted to YAML: ${inputPath} → ${outputPath}` }],
              };
            }
            default: {
              throw new Error(`Unsupported conversion: ${from} → ${to}`);
            }
          }
        }
      }
    },
  },
];
