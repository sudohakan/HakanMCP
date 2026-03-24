import { z } from 'zod';
let _mssqlMod: typeof import('mssql') | null = null;
async function getMssqlMod() {
  if (!_mssqlMod) { try { _mssqlMod = await import('mssql'); } catch { throw new Error('mssql is not installed. Run: npm install mssql'); } }
  return _mssqlMod;
}
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { processRegistry } from '../utils/processRegistry.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sqlite3: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _open: any = null;
async function getSqlite() {
  if (!_sqlite3 || !_open) {
    try {
      _sqlite3 = (await import('sqlite3')).default;
      _open = (await import('sqlite')).open;
    } catch {
      throw new Error('sqlite3 is not available. Install it with: npm install sqlite3 (requires node-gyp build tools on Windows), or use better-sqlite3 as an alternative.');
    }
  }
  return { sqlite3: _sqlite3, open: _open };
}
import { getPgPool, getMysqlPool, getMssqlPool, dbPoolManager } from '../utils/dbPoolManager.js';
import type { MSSQLConfig } from '../utils/dbPoolManager.js';
import { assertPathSafe } from '../utils/common.js';

const execFileAsync = promisify(execFile);

const mysqlConnSchema = z.object({
  host: z.string(),
  port: z.number().default(3306),
  user: z.string(),
  password: z.string(),
  database: z.string(),
});

const mssqlConnSchema = z.object({
  server: z.string(),
  port: z.number().default(1433),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  encrypt: z.boolean().default(true),
  trustServerCertificate: z.boolean().default(false),
});

function buildMssqlConfig(p: z.infer<typeof mssqlConnSchema>): MSSQLConfig {
  return {
    server: p.server,
    port: p.port,
    database: p.database,
    user: p.user,
    password: p.password,
    options: {
      encrypt: p.encrypt,
      trustServerCertificate: p.trustServerCertificate,
      enableArithAbort: true,
    },
  };
}

export const dbTools = [
  {
    name: 'db',
    description:
      'Database operations for PostgreSQL, MySQL, SQLite, and MSSQL. ' +
      'Actions: query, listTables, getTableSchema, backup, restore, closeConnections, getPoolStats. ' +
      'Set dbType to choose the engine, then supply the matching connection parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['query', 'listTables', 'getTableSchema', 'backup', 'restore', 'closeConnections', 'getPoolStats'],
          description: 'Operation to perform',
        },
        dbType: {
          type: 'string',
          enum: ['postgres', 'mysql', 'sqlite', 'mssql'],
          description: 'Database engine (required for query/listTables/getTableSchema/backup/restore)',
        },
        query: { type: 'string', description: 'SQL query to execute (query action)' },
        tableName: { type: 'string', description: 'Table name (getTableSchema action)' },
        connectionString: { type: 'string', description: 'PostgreSQL connection string (postgres only)' },
        host: { type: 'string', description: 'Host (mysql/mssql)' },
        port: { type: 'number', description: 'Port (mysql default 3306, mssql default 1433)' },
        user: { type: 'string', description: 'Username (mysql/mssql)' },
        password: { type: 'string', description: 'Password (mysql/mssql)' },
        database: { type: 'string', description: 'Database name (mysql/mssql)' },
        dbPath: { type: 'string', description: 'File path to the SQLite database (sqlite only)' },
        server: { type: 'string', description: 'SQL Server host (mssql only)' },
        schema: { type: 'string', description: 'Schema name (mssql getTableSchema, default: dbo)' },
        encrypt: { type: 'boolean', description: 'Encrypted connection (mssql, default: true)' },
        trustServerCertificate: { type: 'boolean', description: 'Trust server certificate (mssql, default: false)' },
        outputPath: { type: 'string', description: 'Output file path for backup dump (postgres/mysql backup)' },
        backupPath: { type: 'string', description: 'Backup file path on SQL Server host (mssql backup/restore)' },
        inputPath: { type: 'string', description: 'Input dump file path to restore from (postgres/mysql restore)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action } = z.object({ action: z.enum(['query', 'listTables', 'getTableSchema', 'backup', 'restore', 'closeConnections', 'getPoolStats']) }).parse(args);

      switch (action) {
        case 'query': {
          const base = z.object({ dbType: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']), query: z.string() });
          const { dbType, query } = base.parse(args);

          switch (dbType) {
            case 'postgres': {
              const { connectionString } = z.object({ connectionString: z.string() }).parse(args);
              const pool = await getPgPool(connectionString);
              const client = await pool.connect();
              try {
                const result = await client.query(query);
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2),
                    },
                  ],
                };
              } finally {
                client.release();
              }
            }

            case 'mysql': {
              const conn = mysqlConnSchema.parse(args);
              const pool = await getMysqlPool(conn);
              const [rows] = await pool.execute(query);
              return {
                content: [{ type: 'text', text: JSON.stringify({ rows }, null, 2) }],
              };
            }

            case 'sqlite': {
              const { dbPath } = z.object({ dbPath: z.string() }).parse(args);
              const sq = await getSqlite();
              const db = await sq.open({ filename: dbPath, driver: sq.sqlite3.Database });
              try {
                const rows = await db.all(query);
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ rowCount: rows.length, rows }, null, 2),
                    },
                  ],
                };
              } finally {
                await db.close();
              }
            }

            case 'mssql': {
              const conn = mssqlConnSchema.parse(args);
              const pool = await getMssqlPool(buildMssqlConfig(conn));
              const result = await pool.request().query(query);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      { rowsAffected: result.rowsAffected, recordset: result.recordset },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
          }
          break;
        }

        case 'listTables': {
          const { dbType } = z.object({ dbType: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']) }).parse(args);

          switch (dbType) {
            case 'postgres': {
              const { connectionString } = z.object({ connectionString: z.string() }).parse(args);
              const pool = await getPgPool(connectionString);
              const client = await pool.connect();
              try {
                const result = await client.query(
                  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
                );
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(
                        {
                          count: result.rowCount,
                          tables: result.rows.map((r: { table_name?: string }) => r.table_name),
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                };
              } finally {
                client.release();
              }
            }

            case 'mysql': {
              const conn = mysqlConnSchema.parse(args);
              const pool = await getMysqlPool(conn);
              const [rows] = await pool.execute('SHOW TABLES');
              return {
                content: [{ type: 'text', text: JSON.stringify({ tables: rows }, null, 2) }],
              };
            }

            case 'sqlite': {
              const { dbPath } = z.object({ dbPath: z.string() }).parse(args);
              const sq = await getSqlite();
              const db = await sq.open({ filename: dbPath, driver: sq.sqlite3.Database });
              try {
                const tables = await db.all(
                  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                );
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ count: tables.length, tables }, null, 2),
                    },
                  ],
                };
              } finally {
                await db.close();
              }
            }

            case 'mssql': {
              const conn = mssqlConnSchema.parse(args);
              const pool = await getMssqlPool(buildMssqlConfig(conn));
              const result = await pool.request().query(`
                SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
              `);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      { count: result.recordset.length, tables: result.recordset },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
          }
          break;
        }

        case 'getTableSchema': {
          const base = z.object({
            dbType: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']),
            tableName: z.string(),
          });
          const { dbType, tableName } = base.parse(args);

          switch (dbType) {
            case 'postgres': {
              const { connectionString } = z.object({ connectionString: z.string() }).parse(args);
              const pool = await getPgPool(connectionString);
              const client = await pool.connect();
              try {
                const result = await client.query(
                  `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
                   FROM information_schema.columns
                   WHERE table_name = $1
                   ORDER BY ordinal_position`,
                  [tableName],
                );
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ table: tableName, columns: result.rows }, null, 2),
                    },
                  ],
                };
              } finally {
                client.release();
              }
            }

            case 'mysql': {
              const conn = mysqlConnSchema.parse(args);
              const pool = await getMysqlPool(conn);
              const [rows] = await pool.execute(`DESCRIBE ${tableName}`);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ table: tableName, columns: rows }, null, 2),
                  },
                ],
              };
            }

            case 'sqlite': {
              const { dbPath } = z.object({ dbPath: z.string() }).parse(args);
              const sq = await getSqlite();
              const db = await sq.open({ filename: dbPath, driver: sq.sqlite3.Database });
              try {
                const columns = await db.all(`PRAGMA table_info(${tableName})`);
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ table: tableName, columns }, null, 2),
                    },
                  ],
                };
              } finally {
                await db.close();
              }
            }

            case 'mssql': {
              const mssqlTypes = await getMssqlMod();
              const conn = mssqlConnSchema.parse(args);
              const { schema = 'dbo' } = z.object({ schema: z.string().default('dbo') }).parse(args);
              const pool = await getMssqlPool(buildMssqlConfig(conn));
              const result = await pool
                .request()
                .input('schema', mssqlTypes.VarChar, schema)
                .input('table', mssqlTypes.VarChar, tableName).query(`
                  SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
                  FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
                  ORDER BY ORDINAL_POSITION
                `);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      { table: `${schema}.${tableName}`, columns: result.recordset },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
          }
          break;
        }

        case 'backup': {
          const { dbType } = z.object({ dbType: z.enum(['postgres', 'mysql', 'mssql']) }).parse(args);

          switch (dbType) {
            case 'postgres': {
              const { connectionString, outputPath } = z
                .object({ connectionString: z.string(), outputPath: z.string() })
                .parse(args);
              assertPathSafe(outputPath, 'outputPath');
              await execFileAsync('pg_dump', ['-d', connectionString, '-f', outputPath], {
                env: process.env,
              });
              return {
                content: [{ type: 'text', text: `✓ Backup created: ${outputPath}` }],
              };
            }

            case 'mysql': {
              const { outputPath, ...conn } = mysqlConnSchema
                .extend({ outputPath: z.string() })
                .parse(args);
              assertPathSafe(outputPath, 'outputPath');
              await execFileAsync(
                'mysqldump',
                ['-h', conn.host, '-P', String(conn.port), '-u', conn.user, '--result-file', outputPath, conn.database],
                { env: { ...process.env, MYSQL_PWD: conn.password } },
              );
              return {
                content: [{ type: 'text', text: `✓ Backup created: ${outputPath}` }],
              };
            }

            case 'mssql': {
              const { backupPath, ...conn } = mssqlConnSchema
                .extend({ backupPath: z.string() })
                .parse(args);
              const pool = await getMssqlPool(buildMssqlConfig(conn));
              if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(conn.database)) {
                throw new Error('database name contains invalid characters');
              }
              const pathEscaped = backupPath.replace(/'/g, "''");
              await pool.request().query(`
                BACKUP DATABASE [${conn.database}]
                TO DISK = N'${pathEscaped}'
                WITH FORMAT, INIT, COMPRESSION
              `);
              return {
                content: [
                  {
                    type: 'text',
                    text: `✓ Database backed up: ${conn.database} → ${backupPath}`,
                  },
                ],
              };
            }
          }
          break;
        }

        case 'restore': {
          const { dbType } = z.object({ dbType: z.enum(['postgres', 'mysql', 'mssql']) }).parse(args);

          switch (dbType) {
            case 'postgres': {
              const { connectionString, inputPath } = z
                .object({ connectionString: z.string(), inputPath: z.string() })
                .parse(args);
              assertPathSafe(inputPath, 'inputPath');
              await execFileAsync('psql', ['-d', connectionString, '-f', inputPath], {
                env: process.env,
              });
              return {
                content: [{ type: 'text', text: `✓ Database restored from: ${inputPath}` }],
              };
            }

            case 'mysql': {
              const { inputPath, ...conn } = mysqlConnSchema
                .extend({ inputPath: z.string() })
                .parse(args);
              assertPathSafe(inputPath, 'inputPath');
              const mysqlProc = processRegistry.track(
                spawn('mysql', ['-h', conn.host, '-P', String(conn.port), '-u', conn.user, conn.database], {
                  stdio: ['pipe', 'pipe', 'pipe'],
                  env: { ...process.env, MYSQL_PWD: conn.password },
                }),
                'mysql-restore',
              );
              fs.createReadStream(inputPath).pipe(mysqlProc.stdin!);
              await new Promise<void>((resolve, reject) => {
                mysqlProc.on('close', (code) =>
                  code === 0 ? resolve() : reject(new Error(`mysql exit ${code}`)),
                );
                mysqlProc.on('error', reject);
              });
              return {
                content: [{ type: 'text', text: `✓ Database restored from: ${inputPath}` }],
              };
            }

            case 'mssql': {
              const { backupPath, ...conn } = mssqlConnSchema
                .extend({ backupPath: z.string() })
                .parse(args);
              const pool = await getMssqlPool(buildMssqlConfig(conn));
              if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(conn.database)) {
                throw new Error('database name contains invalid characters');
              }
              const pathEscaped = backupPath.replace(/'/g, "''");
              await pool.request().query(`
                RESTORE DATABASE [${conn.database}]
                FROM DISK = N'${pathEscaped}'
                WITH REPLACE
              `);
              return {
                content: [
                  {
                    type: 'text',
                    text: `✓ Database restored: ${conn.database} from ${backupPath}`,
                  },
                ],
              };
            }
          }
          break;
        }

        case 'closeConnections': {
          await dbPoolManager.closeAll();
          return {
            content: [{ type: 'text', text: '✓ All database connection pools closed' }],
          };
        }

        case 'getPoolStats': {
          const stats = dbPoolManager.getStats();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    totalPools: stats.postgresql.count + stats.mysql.count + stats.mssql.count,
                    postgresql: stats.postgresql,
                    mysql: stats.mysql,
                    mssql: stats.mssql,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }
    },
  },
];
