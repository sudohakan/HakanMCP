import { toWSLPath, normalizePath, getHomedir, getTempdir } from '../pathHelper.js';

describe('Path Helper', () => {
  describe('toWSLPath', () => {
    it('converts C:\\ to /mnt/c/', () => {
      expect(toWSLPath('C:\\')).toBe('/mnt/c/');
    });

    it('converts C:\\Users\\Hakan to /mnt/c/Users/Hakan', () => {
      expect(toWSLPath('C:\\Users\\Hakan')).toBe('/mnt/c/Users/Hakan');
    });

    it('converts D:\\Work\\project to /mnt/d/Work/project', () => {
      expect(toWSLPath('D:\\Work\\project')).toBe('/mnt/d/Work/project');
    });

    it('normalizes drive letter to lowercase', () => {
      expect(toWSLPath('c:\\foo')).toBe('/mnt/c/foo');
      expect(toWSLPath('C:\\foo')).toBe('/mnt/c/foo');
    });

    it('passes through non-Windows paths unchanged', () => {
      expect(toWSLPath('/home/user')).toBe('/home/user');
      expect(toWSLPath('/tmp')).toBe('/tmp');
    });

    it('handles paths with spaces', () => {
      expect(toWSLPath('C:\\Program Files\\app')).toBe('/mnt/c/Program Files/app');
    });
  });

  describe('normalizePath', () => {
    it('returns a string', () => {
      expect(typeof normalizePath('/foo/bar')).toBe('string');
    });

    it('replaces backslashes with forward slashes on Linux/WSL', () => {
      if (process.platform !== 'win32') {
        expect(normalizePath('C:\\foo\\bar')).toBe('C:/foo/bar');
      }
    });
  });

  describe('getHomedir', () => {
    it('returns a non-empty string', () => {
      const home = getHomedir();
      expect(typeof home).toBe('string');
      expect(home.length).toBeGreaterThan(0);
    });
  });

  describe('getTempdir', () => {
    it('returns a non-empty string', () => {
      const tmp = getTempdir();
      expect(typeof tmp).toBe('string');
      expect(tmp.length).toBeGreaterThan(0);
    });
  });

  describe('toWindowsPath re-export', () => {
    it('is exported from pathHelper', async () => {
      const { toWindowsPath } = await import('../pathHelper.js');
      expect(typeof toWindowsPath).toBe('function');
    });
  });
});
