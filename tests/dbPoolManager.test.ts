import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';

class FakePgPool extends EventEmitter {
  public end = jest.fn(async () => undefined);
  constructor(public options: Record<string, unknown>) {
    super();
  }
}

class FakeMssqlPool extends EventEmitter {
  public close = jest.fn(async () => undefined);
  public connect = jest.fn(async () => undefined);
  constructor(public config: Record<string, unknown>) {
    super();
  }
}

const setupDbPoolManager = async () => {
  jest.resetModules();

  const pgConstructor = jest.fn(() => new FakePgPool({}));
  await jest.unstable_mockModule('pg', () => ({
    __esModule: true,
    default: { Pool: pgConstructor },
    Pool: pgConstructor,
  }));

  const mysqlPool = { end: jest.fn(async () => undefined) };
  const mysqlCreatePool = jest.fn(() => mysqlPool);
  await jest.unstable_mockModule('mysql2/promise', () => ({
    __esModule: true,
    default: { createPool: mysqlCreatePool },
    createPool: mysqlCreatePool,
  }));

  const mssqlPoolInstances: FakeMssqlPool[] = [];
  const connectionPoolCtor = jest.fn((config: Record<string, unknown>) => {
    const pool = new FakeMssqlPool(config);
    mssqlPoolInstances.push(pool);
    return pool;
  });
  await jest.unstable_mockModule('mssql', () => ({
    __esModule: true,
    default: { ConnectionPool: connectionPoolCtor },
    ConnectionPool: connectionPoolCtor,
  }));

  const loggerMock = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  await jest.unstable_mockModule('../src/utils/logger.js', () => ({
    logger: loggerMock,
  }));

  const processOn = jest.spyOn(process, 'on').mockImplementation(() => process);
  const intervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({} as NodeJS.Timeout);
  const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => {});

  const module = await import('../src/utils/dbPoolManager');
  const manager = new module.DatabasePoolManager({ max: 2 }, 10 * 60 * 1000, 5 * 1000);
  manager.stopAutoCleanup();

  return {
    DatabasePoolManager: module.DatabasePoolManager,
    manager,
    pgConstructor,
    mysqlCreatePool,
    mysqlPool,
    mssqlPoolInstances,
    connectionPoolCtor,
    loggerMock,
    restore: () => {
      processOn.mockRestore();
      intervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    },
  };
};

describe('DatabasePoolManager', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates and reuses PostgreSQL pools', async () => {
    const setup = await setupDbPoolManager();
    const pool1 = setup.manager.getPgPool('postgres://user:pass@host/db');
    const pool2 = setup.manager.getPgPool('postgres://user:pass@host/db');

    expect(pool1).toBe(pool2);
    expect(setup.pgConstructor).toHaveBeenCalledTimes(1);
    setup.restore();
  });

  it('creates MySQL pool with hashed key and reuses existing pool', async () => {
    const setup = await setupDbPoolManager();
    const config = {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'pwd',
      database: 'test',
    };
    const pool1 = await setup.manager.getMysqlPool(config);
    const pool2 = await setup.manager.getMysqlPool(config);

    expect(pool1).toBe(pool2);
    expect(setup.mysqlCreatePool).toHaveBeenCalledTimes(1);
    setup.restore();
  });

  it('creates MSSQL pool respecting Windows authentication options', async () => {
    const setup = await setupDbPoolManager();
    const config = {
      server: 'mssql-host',
      database: 'db',
      domain: 'ACME',
      options: { trustedConnection: true, trustServerCertificate: true },
    };

    const pool = await setup.manager.getMssqlPool(config);
    expect(setup.connectionPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        server: 'mssql-host',
        pool: expect.objectContaining({ max: 2 }),
        options: expect.objectContaining({ trustedConnection: true }),
      }),
    );
    expect(pool.connect).toHaveBeenCalled();
    setup.restore();
  });

  it('cleans up idle pools and closes resources', async () => {
    const setup = await setupDbPoolManager();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

    const stalePg = new FakePgPool({});
    const staleMysql = { end: jest.fn(async () => undefined) };
    const staleMssql = new FakeMssqlPool({});

    const mgr = setup.manager as {
      pgPools: Map<string, unknown>;
      mysqlPools: Map<string, unknown>;
      mssqlPools: Map<string, unknown>;
      cleanupIdlePools: () => Promise<void>;
    };
    mgr.pgPools.set('pg', { pool: stalePg, lastUsed: 1, created: 5 });
    mgr.mysqlPools.set('mysql', { pool: staleMysql, lastUsed: 1, created: 5 });
    mgr.mssqlPools.set('mssql', { pool: staleMssql, lastUsed: 1, created: 5 });

    await mgr.cleanupIdlePools();

    expect(stalePg.end).toHaveBeenCalled();
    expect(staleMysql.end).toHaveBeenCalled();
    expect(staleMssql.close).toHaveBeenCalled();
    nowSpy.mockRestore();
    setup.restore();
  });

  it('closeAll stops auto cleanup and clears pools', async () => {
    const setup = await setupDbPoolManager();
    const pgPool = setup.manager.getPgPool('postgres://user:pass@host/db');
    await setup.manager.closeAll();

    expect(pgPool.end).toHaveBeenCalled();
    const stats = setup.manager.getStats();
    expect(stats.postgresql.count).toBe(0);
    setup.restore();
  });
});
