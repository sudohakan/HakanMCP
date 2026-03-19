import { systemTools } from '../src/tools/system';
import fs from 'node:fs';
import path from 'node:path';

describe('System Tools', () => {
  const testDir = path.join('/tmp', 'system-test');

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

      it('should populate HOME and USERPROFILE when missing', async () => {
        const tool = systemTools.find((t) => t.name === 'sys_runCommand');
        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;

        delete process.env.HOME;
        delete process.env.USERPROFILE;

        const command =
          process.platform === 'win32'
            ? 'echo HOME=%HOME% && echo USERPROFILE=%USERPROFILE%'
            : 'printf "HOME=%s\\nUSERPROFILE=%s\\n" "$HOME" "$USERPROFILE"';

        try {
          const result = await tool!.handler({ command });

          expect(result.content[0].text).toContain('HOME=');
          expect(result.content[0].text).toContain('USERPROFILE=');
        } finally {
          if (originalHome !== undefined) process.env.HOME = originalHome;
          if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
        }
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
