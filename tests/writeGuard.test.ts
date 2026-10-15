import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertWriteAllowed, findPipelineWrite, findSqlWrite } from '../src/utils/writeGuard';
import { dbTools } from '../src/tools/db';
import { mongoTools } from '../src/tools/mongodb';

describe('findSqlWrite', () => {
  it.each([
    ['SELECT TOP 10 * FROM Tenant WITH (NOLOCK)'],
    ['WITH x AS (SELECT 1 AS a) SELECT a FROM x'],
    ["SELECT * FROM Log WHERE Message = 'delete failed; drop it'"],
    ['-- update later\nSELECT 1'],
    ['/* DROP TABLE x */ SELECT 1'],
    ['SELECT UpdatedAt, DeletedDate FROM Invoice'],
    ['SELECT [Delete], [Update] FROM Perm'],
    ['SELECT "insert" FROM t'],
    ['SELECT @n = COUNT(*) FROM T'],
  ])('treats %j as a read', (sql) => {
    expect(findSqlWrite(sql)).toBeNull();
  });

  it.each([
    ['UPDATE Invoice SET Status = 2 WHERE Id = 5', 'UPDATE'],
    ['delete from Tenant where Id = 1', 'DELETE'],
    ['INSERT INTO t VALUES (1)', 'INSERT'],
    ['DROP TABLE #tmp', 'DROP'],
    ['ALTER TABLE t ADD c INT', 'ALTER'],
    ['EXEC dbo.RecalcBalances', 'EXEC'],
    ["sp_rename 'a', 'b'", 'SP_RENAME'],
    ['SELECT 1; TRUNCATE TABLE Log', 'TRUNCATE'],
    ['SELECT * INTO Backup_Invoice FROM Invoice', 'SELECT ... INTO'],
    ["SELECT '--x'; DELETE FROM t", 'DELETE'],
    ["SELECT 'it''s'; DROP TABLE t", 'DROP'],
    ['SELECT "a--b" FROM t; UPDATE t SET a = 1', 'UPDATE'],
  ])('flags %j as a write', (sql, keyword) => {
    expect(findSqlWrite(sql)).toBe(keyword);
  });
});

describe('findPipelineWrite', () => {
  it('finds $out and $merge stages only', () => {
    expect(findPipelineWrite([{ $match: { a: 1 } }, { $group: { _id: '$a' } }])).toBeNull();
    expect(findPipelineWrite([{ $match: {} }, { $out: 'copy' }])).toBe('$out');
    expect(findPipelineWrite([{ $merge: { into: 'x' } }])).toBe('$merge');
  });
});

describe('assertWriteAllowed', () => {
  it('passes only on an explicit true', () => {
    expect(() => assertWriteAllowed('UPDATE', true)).not.toThrow();
    expect(() => assertWriteAllowed('UPDATE', false)).toThrow(/Write blocked \(UPDATE\)/);
    expect(() => assertWriteAllowed('UPDATE', undefined)).toThrow(/allowWrite: true/);
  });
});

describe('db tool write guard', () => {
  const tool = dbTools[0]!;
  const dbPath = path.join(os.tmpdir(), `write-guard-${process.pid}.db`);
  const run = (query: string, extra: Record<string, unknown> = {}) =>
    tool.handler({ action: 'query', dbType: 'sqlite', dbPath, query, ...extra });

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    await run('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)', { allowWrite: true });
    await run("INSERT INTO items (name) VALUES ('kept')", { allowWrite: true });
  });

  afterEach(async () => {
    await tool.handler({ action: 'closeConnections' });
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('rejects a write without allowWrite and leaves the data untouched', async () => {
    await expect(run('DELETE FROM items')).rejects.toThrow(/Write blocked \(DELETE\)/);
    const result = await run('SELECT COUNT(*) AS n FROM items');
    expect(JSON.parse(result.content[0].text).rows[0].n).toBe(1);
  });

  it('runs the write when allowWrite is true', async () => {
    await run('DELETE FROM items', { allowWrite: true });
    const result = await run('SELECT COUNT(*) AS n FROM items');
    expect(JSON.parse(result.content[0].text).rows[0].n).toBe(0);
  });

  it('rejects restore without allowWrite before touching any file', async () => {
    await expect(
      tool.handler({ action: 'restore', dbType: 'postgres', connectionString: 'postgres://x', inputPath: '/nonexistent.sql' }),
    ).rejects.toThrow(/Write blocked \(restore\)/);
  });
});

describe('mongo tool write guard', () => {
  const tool = mongoTools[0]!;

  it.each(['insert', 'update', 'delete', 'createIndex'])('rejects %s without allowWrite', async (action) => {
    await expect(tool.handler({ action, connectionId: 'none', database: 'd', collection: 'c' })).rejects.toThrow(
      new RegExp(`Write blocked \\(mongo ${action}\\)`),
    );
  });

  it('rejects an aggregate that writes with $out', async () => {
    await expect(
      tool.handler({ action: 'aggregate', connectionId: 'none', database: 'd', collection: 'c', pipeline: [{ $out: 'copy' }] }),
    ).rejects.toThrow(/Write blocked \(mongo aggregate \$out\)/);
  });

  it('does not gate reads', async () => {
    await expect(tool.handler({ action: 'find', connectionId: 'none', database: 'd', collection: 'c' })).rejects.not.toThrow(
      /Write blocked/,
    );
  });
});
