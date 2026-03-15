import { envTools } from '../src/tools/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Environment Tools', () => {
  let testEnvDir: string;
  let testEnvFile: string;

  beforeEach(() => {
    testEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hakan-mcp-env-test-'));
    testEnvFile = path.join(testEnvDir, 'test.env');
  });

  afterEach(() => {
    // Cleanup test env directory
    try {
      fs.rmSync(testEnvDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('env_getVar', () => {
    it('should get existing environment variable', async () => {
      const tool = envTools.find((t) => t.name === 'env_getVar');
      process.env.TEST_VAR = 'test-value';

      const result = await tool!.handler({ key: 'TEST_VAR' });

      const response = JSON.parse(result.content[0].text);
      expect(response.key).toBe('TEST_VAR');
      expect(response.value).toBe('test-value');
    });

    it('should return null for non-existent variable', async () => {
      const tool = envTools.find((t) => t.name === 'env_getVar');

      const result = await tool!.handler({ key: 'NON_EXISTENT_VAR' });

      const response = JSON.parse(result.content[0].text);
      expect(response.value).toBeNull();
    });
  });

  describe('env_setVar', () => {
    it('should set environment variable', async () => {
      const tool = envTools.find((t) => t.name === 'env_setVar');

      const result = await tool!.handler({
        key: 'NEW_VAR',
        value: 'new-value',
      });

      expect(result.content[0].text).toContain('NEW_VAR');
      expect(process.env.NEW_VAR).toBe('new-value');
    });
  });

  describe('env_listVars', () => {
    it('should list all environment variables', async () => {
      const tool = envTools.find((t) => t.name === 'env_listVars');

      const result = await tool!.handler({});

      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBeGreaterThan(0);
      expect(response.variables).toBeInstanceOf(Array);
    });
  });

  describe('env_loadFromFile', () => {
    it('should load variables from .env file', async () => {
      const tool = envTools.find((t) => t.name === 'env_loadFromFile');

      // Create test .env file
      fs.writeFileSync(testEnvFile, 'TEST_LOAD_VAR=loaded-value\n', 'utf8');

      const result = await tool!.handler({ path: testEnvFile });

      expect(result.content[0].text).toContain('Loaded environment variables');
      expect(result.content[0].text).toContain(testEnvFile);
    });
  });

  describe('env_saveToFile', () => {
    it('should save environment variables to file', async () => {
      const tool = envTools.find((t) => t.name === 'env_saveToFile');
      process.env.SAVE_TEST_VAR = 'save-value';

      const result = await tool!.handler({ path: testEnvFile });

      expect(result.content[0].text).toContain('Saved environment variables');
      expect(fs.existsSync(testEnvFile)).toBe(true);

      const content = fs.readFileSync(testEnvFile, 'utf8');
      expect(content).toContain('SAVE_TEST_VAR=save-value');
    });
  });

  describe('env_deleteVar', () => {
    it('should delete environment variable', async () => {
      const tool = envTools.find((t) => t.name === 'env_deleteVar');
      process.env.DELETE_TEST_VAR = 'to-delete';

      const result = await tool!.handler({ key: 'DELETE_TEST_VAR' });

      expect(result.content[0].text).toContain('Deleted environment variable');
      expect(process.env.DELETE_TEST_VAR).toBeUndefined();
    });
  });
});
