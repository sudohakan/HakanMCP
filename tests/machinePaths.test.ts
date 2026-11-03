import os from 'node:os';
import path from 'node:path';
import { expandCatalogValue, getCatalogServer, loadCatalog } from '../src/catalog/index';
import { allowedWriteRoots, safePath } from '../src/tools/_httpShared';

const ENV_NAMES = ['HAKANMCP_TEST_DIR', 'HAKANMCP_WRITE_ROOTS', 'INFOSET_MCP_DIR'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV_NAMES) saved[name] = process.env[name];
});
afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('expandCatalogValue', () => {
  it('expands a leading ~ to the home directory', () => {
    expect(expandCatalogValue('~/.chroma-data', 'chroma')).toBe(`${os.homedir()}/.chroma-data`);
    expect(expandCatalogValue('~', 'chroma')).toBe(os.homedir());
  });

  it('leaves a ~ that is not leading alone', () => {
    expect(expandCatalogValue('a~/b', 'x')).toBe('a~/b');
  });

  it('substitutes ${NAME} from the environment', () => {
    process.env.HAKANMCP_TEST_DIR = '/opt/tool';
    expect(expandCatalogValue('${HAKANMCP_TEST_DIR}/dist/index.js', 'x')).toBe('/opt/tool/dist/index.js');
  });

  it('names the server and the variable when it is unset', () => {
    delete process.env.HAKANMCP_TEST_DIR;
    expect(() => expandCatalogValue('${HAKANMCP_TEST_DIR}/x', 'gtasks')).toThrow(/gtasks.*HAKANMCP_TEST_DIR/);
  });
});

describe('catalog has no machine-specific paths', () => {
  it('servers.json carries no absolute home or checkout path', () => {
    const raw = JSON.stringify(loadCatalog());
    expect(raw).not.toMatch(/\/home\/[a-z]|\/mnt\/c\/(dev|Users)\//);
  });

  it('getCatalogServer returns expanded args', () => {
    process.env.INFOSET_MCP_DIR = '/srv/infoset-mcp';
    expect(getCatalogServer('infoset')?.args).toEqual(['/srv/infoset-mcp/src/mcp-server.mjs']);
  });
});

describe('allowedWriteRoots', () => {
  it('always allows home and temp', () => {
    delete process.env.HAKANMCP_WRITE_ROOTS;
    expect(allowedWriteRoots()).toEqual([os.homedir(), os.tmpdir()]);
  });

  it('adds roots from HAKANMCP_WRITE_ROOTS, skipping empty parts', () => {
    process.env.HAKANMCP_WRITE_ROOTS = ['/data/a', '', ' /data/b '].join(path.delimiter);
    expect(allowedWriteRoots()).toEqual([os.homedir(), os.tmpdir(), path.resolve('/data/a'), path.resolve('/data/b')]);
  });

  it('safePath honours an extra root and still rejects outside paths', () => {
    process.env.HAKANMCP_WRITE_ROOTS = '/data/a';
    expect(safePath('/data/a/file.txt', 'write')).toBe(path.resolve('/data/a/file.txt'));
    expect(() => safePath('/data/ab/file.txt', 'write')).toThrow(/not allowed/);
  });
});
