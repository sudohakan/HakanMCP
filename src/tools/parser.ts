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
    description: 'Parse content string. Actions: yaml, json, xml, csv',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['yaml', 'json', 'xml', 'csv'] },
        content: { type: 'string' },
        delimiter: { type: 'string' },
      },
      required: ['format', 'content'],
    },
    handler: async (args: unknown) => {
      const { format, content, delimiter } = z
        .object({
          format: z.enum(['yaml', 'json', 'xml', 'csv']),
          content: z.string(),
          delimiter: z.string().optional(),
        })
        .parse(args);

      switch (format) {
        case 'yaml': {
          const parsed = yaml.load(content);
          return {
            content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
          };
        }
        case 'json': {
          const parsed = JSON.parse(content);
          return {
            content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
          };
        }
        case 'xml': {
          const parsed = await parseXml(content);
          return {
            content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
          };
        }
        case 'csv': {
          const records = csvParse(content, {
            columns: true,
            skip_empty_lines: true,
            delimiter: delimiter ?? ',',
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(records, null, 2) }],
          };
        }
      }
    },
  },
  {
    name: 'convert_file',
    description: 'Convert a file between JSON and YAML formats',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', enum: ['json', 'yaml'] },
        to: { type: 'string', enum: ['json', 'yaml'] },
        inputPath: { type: 'string' },
        outputPath: { type: 'string' },
      },
      required: ['from', 'to', 'inputPath', 'outputPath'],
    },
    handler: async (args: unknown) => {
      const { from, to, inputPath, outputPath } = z
        .object({
          from: z.enum(['json', 'yaml']),
          to: z.enum(['json', 'yaml']),
          inputPath: z.string(),
          outputPath: z.string(),
        })
        .parse(args);

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
    },
  },
];
