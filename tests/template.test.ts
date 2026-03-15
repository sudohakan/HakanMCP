import { jest } from '@jest/globals';

// Mock fs
jest.unstable_mockModule('node:fs', async () => {
  const original = await jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...original,
    default: {
      ...original,
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
    },
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
  };
});

const { templateTools } = await import('../src/tools/template');
const fs = (await import('node:fs')).default;

describe('Template Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('render_template', () => {
    it('should render template with data', async () => {
      const tool = templateTools.find((t) => t.name === 'render_template');
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        template: 'Hello {{name}}!',
        data: { name: 'World' },
      });

      expect(result.content[0].text).toBe('Hello World!');
    });

    it('should handle complex data structures', async () => {
      const tool = templateTools.find((t) => t.name === 'render_template');

      const result = await tool!.handler({
        template: '{{#each items}}{{this.name}}: {{this.value}}\n{{/each}}',
        data: {
          items: [
            { name: 'A', value: 1 },
            { name: 'B', value: 2 },
          ],
        },
      });

      expect(result.content[0].text).toContain('A: 1');
      expect(result.content[0].text).toContain('B: 2');
    });
  });

  describe('compile_template', () => {
    it('should read template file, render, and write to output', async () => {
      const tool = templateTools.find((t) => t.name === 'compile_template');

      // Mock readFileSync to return template
      (fs.readFileSync as jest.Mock).mockReturnValue('Hello {{name}}!');

      const result = await tool!.handler({
        templatePath: '/path/to/template.hbs',
        outputPath: '/path/to/output.txt',
        data: { name: 'File' },
      });

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/template.hbs', 'utf8');
      expect(fs.writeFileSync).toHaveBeenCalledWith('/path/to/output.txt', 'Hello File!', 'utf8');
      expect(result.content[0].text).toContain('Template compiled');
    });
  });
});
