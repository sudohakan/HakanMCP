import { systemTools } from '../src/tools/system';
import fs from 'node:fs';
import path from 'node:path';

describe('System Tools', () => {
  const testDir = path.join('/tmp', 'system-test');
  const testFile = path.join(testDir, 'test.txt');

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('File System Tools', () => {
    describe('fs_listDir', () => {
      it('should list directory contents', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_listDir');
        expect(tool).toBeDefined();

        // Create test files
        fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content1', 'utf8');
        fs.writeFileSync(path.join(testDir, 'file2.txt'), 'content2', 'utf8');
        fs.mkdirSync(path.join(testDir, 'subdir'));

        const result = await tool!.handler({ path: testDir });

        const response = JSON.parse(result.content[0].text);
        expect(response.path).toBe(testDir);
        expect(response.count).toBe(3);
        expect(response.files).toHaveLength(3);

        const fileNames = response.files.map((f: { name?: string }) => f.name);
        expect(fileNames).toContain('file1.txt');
        expect(fileNames).toContain('file2.txt');
        expect(fileNames).toContain('subdir');
      });

      it('should identify file types', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_listDir');

        fs.writeFileSync(path.join(testDir, 'test.txt'), 'content', 'utf8');
        fs.mkdirSync(path.join(testDir, 'folder'));

        const result = await tool!.handler({ path: testDir });

        const response = JSON.parse(result.content[0].text);
        const testFile = response.files.find((f: { name?: string }) => f.name === 'test.txt');
        const testFolder = response.files.find((f: { name?: string }) => f.name === 'folder');

        expect(testFile.type).toBe('file');
        expect(testFolder.type).toBe('dir');
      });
    });

    describe('fs_readFile', () => {
      it('should read file content', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_readFile');

        const content = 'Hello, World!';
        fs.writeFileSync(testFile, content, 'utf8');

        const result = await tool!.handler({ path: testFile });

        expect(result.content[0].text).toBe(content);
      });

      it('should throw error for non-existent file', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_readFile');

        await expect(tool!.handler({ path: '/tmp/non-existent-file.txt' })).rejects.toThrow();
      });
    });

    describe('fs_writeFile', () => {
      it('should write content to file', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_writeFile');

        const content = 'Test content';
        const result = await tool!.handler({ path: testFile, content });

        expect(result.content[0].text).toContain('File written');
        expect(fs.existsSync(testFile)).toBe(true);
        expect(fs.readFileSync(testFile, 'utf8')).toBe(content);
      });

      it('should overwrite existing file', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_writeFile');

        fs.writeFileSync(testFile, 'old content', 'utf8');

        const newContent = 'new content';
        await tool!.handler({ path: testFile, content: newContent });

        expect(fs.readFileSync(testFile, 'utf8')).toBe(newContent);
      });
    });

    describe('fs_deleteFile', () => {
      it('should delete file', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_deleteFile');

        fs.writeFileSync(testFile, 'content', 'utf8');
        expect(fs.existsSync(testFile)).toBe(true);

        const result = await tool!.handler({ path: testFile });

        expect(result.content[0].text).toContain('Silindi');
        expect(fs.existsSync(testFile)).toBe(false);
      });

      it('should delete directory recursively', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_deleteFile');

        const subdir = path.join(testDir, 'subdir');
        fs.mkdirSync(subdir);
        fs.writeFileSync(path.join(subdir, 'file.txt'), 'content', 'utf8');

        await tool!.handler({ path: subdir });

        expect(fs.existsSync(subdir)).toBe(false);
      });
    });

    describe('fs_moveFile', () => {
      it('should move file', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_moveFile');

        const source = testFile;
        const destination = path.join(testDir, 'moved.txt');

        fs.writeFileSync(source, 'content', 'utf8');

        const result = await tool!.handler({ source, destination });

        expect(result.content[0].text).toContain('Moved');
        expect(fs.existsSync(source)).toBe(false);
        expect(fs.existsSync(destination)).toBe(true);
      });

      it('should rename file', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_moveFile');

        const source = testFile;
        const destination = path.join(testDir, 'renamed.txt');

        fs.writeFileSync(source, 'content', 'utf8');

        await tool!.handler({ source, destination });

        expect(fs.existsSync(destination)).toBe(true);
        expect(fs.readFileSync(destination, 'utf8')).toBe('content');
      });
    });

    describe('fs_makeDir', () => {
      it('should create directory', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_makeDir');

        const newDir = path.join(testDir, 'newdir');

        const result = await tool!.handler({ path: newDir });

        expect(result.content[0].text).toContain('Directory created');
        expect(fs.existsSync(newDir)).toBe(true);
        expect(fs.statSync(newDir).isDirectory()).toBe(true);
      });

      it('should create nested directories', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_makeDir');

        const nestedDir = path.join(testDir, 'level1', 'level2', 'level3');

        await tool!.handler({ path: nestedDir });

        expect(fs.existsSync(nestedDir)).toBe(true);
      });
    });

    describe('fs_copyFile', () => {
      it('should copy file', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_copyFile');

        const source = testFile;
        const destination = path.join(testDir, 'copied.txt');
        const content = 'test content';

        fs.writeFileSync(source, content, 'utf8');

        const result = await tool!.handler({ source, destination });

        expect(result.content[0].text).toContain('Copied');
        expect(fs.existsSync(source)).toBe(true); // Original still exists
        expect(fs.existsSync(destination)).toBe(true);
        expect(fs.readFileSync(destination, 'utf8')).toBe(content);
      });

      it('should copy directory recursively', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_copyFile');

        const sourceDir = path.join(testDir, 'source');
        const destDir = path.join(testDir, 'dest');

        fs.mkdirSync(sourceDir);
        fs.writeFileSync(path.join(sourceDir, 'file1.txt'), 'content1', 'utf8');
        fs.writeFileSync(path.join(sourceDir, 'file2.txt'), 'content2', 'utf8');

        await tool!.handler({ source: sourceDir, destination: destDir });

        expect(fs.existsSync(destDir)).toBe(true);
        expect(fs.existsSync(path.join(destDir, 'file1.txt'))).toBe(true);
        expect(fs.existsSync(path.join(destDir, 'file2.txt'))).toBe(true);
      });
    });

    describe('fs_searchFiles', () => {
      it('should search files with glob pattern', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_searchFiles');

        // Create test files
        fs.writeFileSync(path.join(testDir, 'test1.txt'), 'content', 'utf8');
        fs.writeFileSync(path.join(testDir, 'test2.txt'), 'content', 'utf8');
        fs.writeFileSync(path.join(testDir, 'other.md'), 'content', 'utf8');

        const result = await tool!.handler({
          pattern: '*.txt',
          cwd: testDir,
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.count).toBe(2);
        expect(response.files.some((f: string) => f.includes('test1.txt'))).toBe(true);
        expect(response.files.some((f: string) => f.includes('test2.txt'))).toBe(true);
      });

      it('should handle recursive glob patterns', async () => {
        const tool = systemTools.find((t) => t.name === 'fs_searchFiles');

        const subdir = path.join(testDir, 'subdir');
        fs.mkdirSync(subdir);
        fs.writeFileSync(path.join(testDir, 'root.js'), 'content', 'utf8');
        fs.writeFileSync(path.join(subdir, 'nested.js'), 'content', 'utf8');

        const result = await tool!.handler({
          pattern: '**/*.js',
          cwd: testDir,
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.count).toBe(2);
      });
    });
  });

  describe('System Commands', () => {
    describe('sys_runCommand', () => {
      it('should execute simple command', async () => {
        const tool = systemTools.find((t) => t.name === 'sys_runCommand');

        const command = process.platform === 'win32' ? 'echo test' : 'echo test';

        const result = await tool!.handler({ command });

        expect(result.content[0].text).toContain('STDOUT');
        expect(result.content[0].text).toContain('test');
      });

      it('should respect cwd parameter', async () => {
        const tool = systemTools.find((t) => t.name === 'sys_runCommand');

        const command = process.platform === 'win32' ? 'cd' : 'pwd';

        const result = await tool!.handler({ command, cwd: testDir });

        expect(result.content[0].text).toContain(testDir);
      });
    });

    describe('sys_getSystemInfo', () => {
      it('should return system information', async () => {
        const tool = systemTools.find((t) => t.name === 'sys_getSystemInfo');

        const result = await tool!.handler({});

        const info = JSON.parse(result.content[0].text);
        expect(info.platform).toBeDefined();
        expect(info.arch).toBeDefined();
        expect(info.cpus).toBeGreaterThan(0);
        expect(info.totalMemory).toBeGreaterThan(0);
        expect(info.freeMemory).toBeGreaterThan(0);
        expect(info.hostname).toBeDefined();
      });
    });

    describe('sys_listProcesses', () => {
      it('should list running processes', async () => {
        const tool = systemTools.find((t) => t.name === 'sys_listProcesses');

        const result = await tool!.handler({});

        expect(result.content[0].text).toBeDefined();
        expect(result.content[0].text.length).toBeGreaterThan(0);
      }, 10000);
    });
  });
});
