/**
 * Database connection pool manager with automatic cleanup
 * Manages PostgreSQL and MySQL connection pools efficiently
 */

import type pg from 'pg';
import type mysql from 'mysql2/promise';
import type mssql from 'mssql';
import { createHash, createHmac } from 'crypto';
import { logger } from './logger.js';

let _pg: typeof import('pg').default | null = null;
let _mysql: typeof import('mysql2/promise') | null = null;
let _mssql: typeof import('mssql') | null = null;

async function loadPg() {
  if (!_pg) { try { _pg = (await import('pg')).default; } catch { throw new Error('pg is not installed. Run: npm install pg'); } }
  return _pg;
}
async function loadMysql() {
  if (!_mysql) { try { _mysql = await import('mysql2/promise'); } catch { throw new Error('mysql2 is not installed. Run: npm install mysql2'); } }
  return _mysql;
}
async function loadMssql() {
  if (!_mssql) { try { _mssql = (await import('mssql')).default as unknown as typeof import('mssql'); } catch { throw new Error('mssql is not installed. Run: npm install mssql'); } }
  return _mssql;
}

export interface PoolConfig {
  max?: number;
  min?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

interface PoolEntry<T> {
  pool: T;
  lastUsed: number;
  created: number;
}

export interface MSSQLConfig {
  server: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  domain?: string;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    enableArithAbort?: boolean;
    trustedConnection?: boolean;
    integratedSecurity?: boolean;
  };
}

const DEFAULT_POOL_CONFIG: Required<PoolConfig> = {
  max: 10,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

export class DatabasePoolManager {
  private pgPools = new Map<string, PoolEntry<pg.Pool>>();
  private mysqlPools = new Map<string, PoolEntry<mysql.Pool>>();
  private mssqlPools = new Map<string, PoolEntry<mssql.ConnectionPool>>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: Required<PoolConfig>;
  private cleanupIntervalMs: number;
  private maxIdleTime: number;

  constructor(
    config: PoolConfig = {},
    cleanupIntervalMs: number = 5 * 60 * 1000,
    maxIdleTime: number = 10 * 60 * 1000,
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.maxIdleTime = maxIdleTime;

    this.startAutoCleanup();

    logger.info('DatabasePoolManager initialized', {
      config: this.config,
      cleanupIntervalMs,
      maxIdleTime,
    });
  }

  /**
   * Gets or creates a PostgreSQL connection pool
   */
  async getPgPool(connectionString: string): Promise<pg.Pool> {
    const pgMod = await loadPg();
    const hash = this.hashConnectionString(connectionString);

    if (!this.pgPools.has(hash)) {
      logger.info('Creating new PostgreSQL pool', { hash });

      const pool = new pgMod.Pool({
        connectionString,
        max: this.config.max,
        min: this.config.min,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
      });

      pool.on('error', (err) => {
        logger.error('PostgreSQL pool error', err, { hash });
      });

      pool.on('connect', () => {
        logger.debug('PostgreSQL client connected', { hash });
      });

      this.pgPools.set(hash, {
        pool,
        lastUsed: Date.now(),
        created: Date.now(),
      });
    }

    const entry = this.pgPools.get(hash)!;
    entry.lastUsed = Date.now();
    return entry.pool;
  }

  /**
   * Gets or creates a MySQL connection pool
   */
  async getMysqlPool(config: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }): Promise<mysql.Pool> {
    const key = this.hashMysqlConfig(config);

    if (!this.mysqlPools.has(key)) {
      const mysqlMod = await loadMysql();
      logger.info('Creating new MySQL pool', {
        key,
        host: config.host,
        database: config.database,
      });

      const pool = mysqlMod.createPool({
        ...config,
        waitForConnections: true,
        connectionLimit: this.config.max,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
      });

      this.mysqlPools.set(key, {
        pool,
        lastUsed: Date.now(),
        created: Date.now(),
      });
    }

    const entry = this.mysqlPools.get(key)!;
    entry.lastUsed = Date.now();
    return entry.pool;
  }

  /**
   * Gets or creates a MSSQL connection pool
   */
  async getMssqlPool(config: MSSQLConfig): Promise<mssql.ConnectionPool> {
    const key = this.hashMssqlConfig(config);

    if (!this.mssqlPools.has(key)) {
      const mssqlMod = await loadMssql();
      logger.info('Creating new MSSQL pool', {
        key,
        server: config.server,
        database: config.database,
      });

      const useWindowsAuth =
        config.options?.trustedConnection || config.options?.integratedSecurity;

      const poolConfig = {
        server: config.server,
        port: config.port || 1433,
        database: config.database,
        ...(useWindowsAuth
          ? {
              domain: config.domain,
              options: {
                encrypt: config.options?.encrypt ?? true,
                trustServerCertificate: config.options?.trustServerCertificate ?? false,
                enableArithAbort: config.options?.enableArithAbort ?? true,
                trustedConnection: true,
              },
            }
          : {
              user: config.user!,
              password: config.password!,
              options: {
                encrypt: config.options?.encrypt ?? true,
                trustServerCertificate: config.options?.trustServerCertificate ?? false,
                enableArithAbort: config.options?.enableArithAbort ?? true,
              },
            }),
        pool: {
          max: this.config.max,
          min: this.config.min,
          idleTimeoutMillis: this.config.idleTimeoutMillis,
        },
        connectionTimeout: this.config.connectionTimeoutMillis,
        requestTimeout: this.config.connectionTimeoutMillis,
      };

      const pool = new mssqlMod.ConnectionPool(poolConfig);

      await pool.connect();

      pool.on('error', (err: Error) => {
        logger.error('MSSQL pool error', err, { key });
      });

      this.mssqlPools.set(key, {
        pool,
        lastUsed: Date.now(),
        created: Date.now(),
      });
    }

    const entry = this.mssqlPools.get(key)!;
    entry.lastUsed = Date.now();
    return entry.pool;
  }

  /**
   * Starts automatic cleanup of idle pools
   */
  private startAutoCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupIdlePools();
    }, this.cleanupIntervalMs);

    process.on('beforeExit', () => {
      this.closeAll();
    });

    logger.debug('Auto-cleanup started', {
      intervalMs: this.cleanupIntervalMs,
      maxIdleTime: this.maxIdleTime,
    });
  }

  /**
   * Stops automatic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('Auto-cleanup stopped');
    }
  }

  /**
   * Cleans up idle connection pools
   */
  private async cleanupIdlePools(): Promise<void> {
    const now = Date.now();
    const toClose: Array<{ type: string; key: string; close: () => Promise<void> }> = [];

    for (const [hash, entry] of this.pgPools.entries()) {
      if (now - entry.lastUsed > this.maxIdleTime) {
        toClose.push({
          type: 'pg',
          key: hash,
          close: async () => {
            await entry.pool.end();
            this.pgPools.delete(hash);
          },
        });
      }
    }
    for (const [key, entry] of this.mysqlPools.entries()) {
      if (now - entry.lastUsed > this.maxIdleTime) {
        toClose.push({
          type: 'mysql',
          key,
          close: async () => {
            await entry.pool.end();
            this.mysqlPools.delete(key);
          },
        });
      }
    }
    for (const [key, entry] of this.mssqlPools.entries()) {
      if (now - entry.lastUsed > this.maxIdleTime) {
        toClose.push({
          type: 'mssql',
          key,
          close: async () => {
            await entry.pool.close();
            this.mssqlPools.delete(key);
          },
        });
      }
    }

    const results = await Promise.allSettled(toClose.map((x) => x.close()));
    const cleaned = results.filter((r) => r.status === 'fulfilled').length;
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.error('Error closing pool', r.reason, {
          type: toClose[i].type,
          key: toClose[i].key,
        });
      }
    });
    if (cleaned > 0) {
      logger.info('Cleanup completed', { cleaned });
    }
  }

  /**
   * Closes all connection pools immediately
   */
  async closeAll(): Promise<void> {
    logger.info('Closing all database pools', {
      pgPools: this.pgPools.size,
      mysqlPools: this.mysqlPools.size,
      mssqlPools: this.mssqlPools.size,
    });

    this.stopAutoCleanup();

    const promises: Promise<void>[] = [];

    for (const [hash, entry] of this.pgPools.entries()) {
      promises.push(
        entry.pool.end().catch((error) => {
          logger.error('Error closing PostgreSQL pool', error, { hash });
        }),
      );
    }

    for (const [key, entry] of this.mysqlPools.entries()) {
      promises.push(
        entry.pool.end().catch((error) => {
          logger.error('Error closing MySQL pool', error, { key });
        }),
      );
    }

    for (const [key, entry] of this.mssqlPools.entries()) {
      promises.push(
        entry.pool.close().catch((error) => {
          logger.error('Error closing MSSQL pool', error, { key });
        }),
      );
    }

    await Promise.all(promises);

    this.pgPools.clear();
    this.mysqlPools.clear();
    this.mssqlPools.clear();

    logger.info('All database pools closed');
  }

  /**
   * Gets pool statistics
   */
  getStats(): {
    postgresql: { count: number; pools: Array<{ hash: string; age: number; idleTime: number }> };
    mysql: { count: number; pools: Array<{ key: string; age: number; idleTime: number }> };
    mssql: { count: number; pools: Array<{ key: string; age: number; idleTime: number }> };
  } {
    const now = Date.now();

    return {
      postgresql: {
        count: this.pgPools.size,
        pools: Array.from(this.pgPools.entries()).map(([hash, entry]) => ({
          hash,
          age: now - entry.created,
          idleTime: now - entry.lastUsed,
        })),
      },
      mysql: {
        count: this.mysqlPools.size,
        pools: Array.from(this.mysqlPools.entries()).map(([key, entry]) => ({
          key,
          age: now - entry.created,
          idleTime: now - entry.lastUsed,
        })),
      },
      mssql: {
        count: this.mssqlPools.size,
        pools: Array.from(this.mssqlPools.entries()).map(([key, entry]) => ({
          key,
          age: now - entry.created,
          idleTime: now - entry.lastUsed,
        })),
      },
    };
  }

  /**
   * Hashes connection string for secure storage
   */
  private hashConnectionString(connectionString: string): string {
    return createHash('sha256').update(connectionString).digest('hex').substring(0, 16);
  }

  /**
   * Hashes MySQL config for secure storage
   */
  private hashMysqlConfig(config: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }): string {
    const identity = `${config.host}:${config.port}:${config.user}:${config.database}`;
    return createHmac('sha256', config.password).update(identity).digest('hex').substring(0, 16);
  }

  /**
   * Hashes MSSQL config for secure storage
   */
  private hashMssqlConfig(config: MSSQLConfig): string {
    const useWindowsAuth = config.options?.trustedConnection || config.options?.integratedSecurity;
    const identity = useWindowsAuth
      ? `${config.server}:${config.port || 1433}:${config.domain || 'WINDOWS_AUTH'}:${config.database}`
      : `${config.server}:${config.port || 1433}:${config.user}:${config.database}`;
    const secret = useWindowsAuth ? 'windows-auth' : (config.password || '');
    return createHmac('sha256', secret).update(identity).digest('hex').substring(0, 16);
  }
}

export const dbPoolManager = new DatabasePoolManager();

export async function getPgPool(connectionString: string): Promise<pg.Pool> {
  return dbPoolManager.getPgPool(connectionString);
}

export async function getMysqlPool(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Promise<mysql.Pool> {
  return dbPoolManager.getMysqlPool(config);
}

export async function getMssqlPool(config: MSSQLConfig): Promise<mssql.ConnectionPool> {
  return dbPoolManager.getMssqlPool(config);
}
