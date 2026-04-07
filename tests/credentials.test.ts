import { loadCredentials, resolveEnvKeys } from '../src/utils/credentials';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('loadCredentials', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cred-test-'));
    tempFile = join(tempDir, '.credentials.env');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it('parses KEY=value lines', () => {
    writeFileSync(tempFile, 'FOO=bar\nBAZ=qux\n');
    const result = loadCredentials(tempFile);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('skips comments and empty lines', () => {
    writeFileSync(tempFile, '# comment\n\nFOO=bar\n# another\n');
    const result = loadCredentials(tempFile);
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('handles values with = signs', () => {
    writeFileSync(tempFile, 'KEY=abc=def=ghi\n');
    const result = loadCredentials(tempFile);
    expect(result).toEqual({ KEY: 'abc=def=ghi' });
  });

  it('throws on missing file', () => {
    expect(() => loadCredentials('/nonexistent/.credentials.env')).toThrow();
  });
});

describe('resolveEnvKeys', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cred-test-'));
    tempFile = join(tempDir, '.credentials.env');
    writeFileSync(
      tempFile,
      'INFOSET_API_KEY=abc123\nINFOSET_BASE_URL=https://api.infoset.app\nOTHER=unused\n',
    );
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it('resolves requested keys only', () => {
    const result = resolveEnvKeys(['INFOSET_API_KEY', 'INFOSET_BASE_URL'], tempFile);
    expect(result).toEqual({
      INFOSET_API_KEY: 'abc123',
      INFOSET_BASE_URL: 'https://api.infoset.app',
    });
  });

  it('throws on missing key', () => {
    expect(() => resolveEnvKeys(['NONEXISTENT_KEY'], tempFile)).toThrow('NONEXISTENT_KEY');
  });

  it('handles empty value (KEY=)', () => {
    writeFileSync(tempFile, 'EMPTY_KEY=\n');
    const result = resolveEnvKeys(['EMPTY_KEY'], tempFile);
    expect(result).toEqual({ EMPTY_KEY: '' });
  });

  it('returns empty object for empty keys array', () => {
    const result = resolveEnvKeys([], tempFile);
    expect(result).toEqual({});
  });
});

describe('resolveEnvKeys — catalog integration scenario', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cred-test-'));
    tempFile = join(tempDir, '.credentials.env');
    writeFileSync(
      tempFile,
      'INFOSET_API_KEY=be32f162\nINFOSET_BASE_URL=https://api.infoset.app\n',
    );
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it('simulates connectFromCatalog envKeys resolution', () => {
    const envKeys = ['INFOSET_API_KEY', 'INFOSET_BASE_URL'];
    const env = envKeys.length ? resolveEnvKeys(envKeys, tempFile) : undefined;

    expect(env).toBeDefined();
    expect(env).toEqual({
      INFOSET_API_KEY: 'be32f162',
      INFOSET_BASE_URL: 'https://api.infoset.app',
    });
  });

  it('simulates server without envKeys (kali, chroma)', () => {
    const envKeys: string[] | undefined = undefined;
    const env = envKeys?.length ? resolveEnvKeys(envKeys, tempFile) : undefined;

    expect(env).toBeUndefined();
  });

  it('throws descriptive error when credential file missing', () => {
    expect(() => resolveEnvKeys(['INFOSET_API_KEY'], '/nonexistent/path')).toThrow();
  });

  it('throws when one of multiple keys is missing', () => {
    expect(() =>
      resolveEnvKeys(['INFOSET_API_KEY', 'MISSING_KEY'], tempFile),
    ).toThrow('MISSING_KEY');
  });
});
