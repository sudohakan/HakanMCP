import { dbTools } from '../src/tools/db';
import fs from 'node:fs';
import path from 'node:path';

describe('Database Tools', () => {
  const testSqlitePath = path.join('/tmp', 'test.db');

  beforeEach(() => {
    // Clean up test database if exists
    if (fs.existsSync(testSqlitePath)) {
      fs.unlinkSync(testSqlitePath);
    }
  });

  afterEach(async () => {
    // Clean up connections
    const tool = dbTools[0]!;
    await tool.handler({ action: 'closeConnections' });

    // Clean up test files
    if (fs.existsSync(testSqlitePath)) {
      fs.unlinkSync(testSqlitePath);
    }
  });

  describe('SQLite Tools', () => {
    describe('db_querySQLite', () => {
      it('should create table and insert data', async () => {
        const tool = dbTools[0]!;
        expect(tool).toBeDefined();

        // Create table
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
        });

        // Insert data
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: "INSERT INTO users (name, email) VALUES ('John Doe', 'john@example.com')",
        });

        // Query data
        const result = await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: 'SELECT * FROM users',
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.rowCount).toBe(1);
        expect(response.rows[0].name).toBe('John Doe');
        expect(response.rows[0].email).toBe('john@example.com');
      });

      it('should handle multiple queries', async () => {
        const tool = dbTools[0]!;

        // Setup
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)',
        });

        // Insert multiple rows
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: "INSERT INTO products (name, price) VALUES ('Product 1', 10.99)",
        });
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: "INSERT INTO products (name, price) VALUES ('Product 2', 20.50)",
        });

        // Query all
        const result = await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: 'SELECT * FROM products ORDER BY id',
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.rowCount).toBe(2);
        expect(response.rows).toHaveLength(2);
      });
    });

    describe('db_listSQLiteTables', () => {
      it('should list tables in SQLite database', async () => {
        const tool = dbTools[0]!;

        // Create test tables
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: 'CREATE TABLE table1 (id INTEGER PRIMARY KEY)',
        });
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: 'CREATE TABLE table2 (id INTEGER PRIMARY KEY)',
        });

        const result = await tool.handler({
          action: 'listTables',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.count).toBe(2);
        expect(response.tables).toHaveLength(2);

        const tableNames = response.tables.map((t: { name?: string }) => t.name);
        expect(tableNames).toContain('table1');
        expect(tableNames).toContain('table2');
      });

      it('should exclude sqlite internal tables', async () => {
        const tool = dbTools[0]!;

        // Create a user table
        await tool.handler({
          action: 'query',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
          query: 'CREATE TABLE my_table (id INTEGER PRIMARY KEY)',
        });

        const result = await tool.handler({
          action: 'listTables',
          dbType: 'sqlite',
          dbPath: testSqlitePath,
        });

        const response = JSON.parse(result.content[0].text);

        // Should not include sqlite_ prefixed tables
        const tableNames = response.tables.map((t: { name?: string }) => t.name);
        tableNames.forEach((name: string) => {
          expect(name).not.toMatch(/^sqlite_/);
        });
      });
    });
  });

  describe('PostgreSQL Tools', () => {
    const pgConnectionString = process.env.TEST_PG_CONNECTION_STRING;
    const shouldSkip = !pgConnectionString;

    describe('db_queryPostgres', () => {
      it('should execute query on PostgreSQL', async () => {
        if (shouldSkip) {
          console.log('Skipping: TEST_PG_CONNECTION_STRING not set');
          return;
        }

        const tool = dbTools[0]!;

        const result = await tool.handler({
          action: 'query',
          dbType: 'postgres',
          connectionString: pgConnectionString,
          query: 'SELECT 1 as test',
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.rows).toBeDefined();
        expect(response.rows[0].test).toBe(1);
      });
    });

    describe('db_listPostgresTables', () => {
      it('should list PostgreSQL tables', async () => {
        if (shouldSkip) {
          console.log('Skipping: TEST_PG_CONNECTION_STRING not set');
          return;
        }

        const tool = dbTools[0]!;

        const result = await tool.handler({
          action: 'listTables',
          dbType: 'postgres',
          connectionString: pgConnectionString,
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.count).toBeGreaterThanOrEqual(0);
        expect(response.tables).toBeInstanceOf(Array);
      });
    });

    describe('db_getTableSchema', () => {
      it('should get PostgreSQL table schema', async () => {
        if (shouldSkip) {
          console.log('Skipping: TEST_PG_CONNECTION_STRING not set');
          return;
        }

        const tool = dbTools[0]!;

        // Assuming there's a test table, or create one first
        const result = await tool.handler({
          action: 'getTableSchema',
          dbType: 'postgres',
          connectionString: pgConnectionString,
          tableName: 'users', // Replace with actual test table
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.table).toBe('users');
        expect(response.columns).toBeInstanceOf(Array);
      });
    });
  });

  describe('MySQL Tools', () => {
    const mysqlConfig = {
      host: process.env.TEST_MYSQL_HOST || 'localhost',
      port: parseInt(process.env.TEST_MYSQL_PORT || '3306'),
      user: process.env.TEST_MYSQL_USER || 'root',
      password: process.env.TEST_MYSQL_PASSWORD || '',
      database: process.env.TEST_MYSQL_DATABASE || 'test',
    };
    const shouldSkip = !process.env.TEST_MYSQL_HOST;

    describe('db_queryMySQL', () => {
      it('should execute query on MySQL', async () => {
        if (shouldSkip) {
          console.log('Skipping: TEST_MYSQL_HOST not set');
          return;
        }

        const tool = dbTools[0]!;

        const result = await tool.handler({
          action: 'query',
          dbType: 'mysql',
          ...mysqlConfig,
          query: 'SELECT 1 as test',
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.rows).toBeDefined();
      });
    });

    describe('db_listMySQLTables', () => {
      it('should list MySQL tables', async () => {
        if (shouldSkip) {
          console.log('Skipping: TEST_MYSQL_HOST not set');
          return;
        }

        const tool = dbTools[0]!;

        const result = await tool.handler({
          action: 'listTables',
          dbType: 'mysql',
          ...mysqlConfig,
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.tables).toBeInstanceOf(Array);
      });
    });
  });

  describe('Connection Management', () => {
    describe('db_closeConnections', () => {
      it('should close all connection pools', async () => {
        const tool = dbTools[0]!;

        const result = await tool.handler({ action: 'closeConnections' });

        expect(result.content[0].text).toContain('closed');
        expect(result.content[0].text).toContain('database');
      });
    });
  });

  describe('Backup and Restore', () => {
    describe('PostgreSQL', () => {
      it('should backup PostgreSQL database', async () => {
        const pgConnectionString = process.env.TEST_PG_CONNECTION_STRING;
        if (!pgConnectionString) {
          console.log('Skipping: TEST_PG_CONNECTION_STRING not set');
          return;
        }

        const tool = dbTools[0]!;
        const outputFile = '/tmp/test-pg-backup.sql';

        try {
          const result = await tool.handler({
            action: 'backup',
            dbType: 'postgres',
            connectionString: pgConnectionString,
            outputPath: outputFile,
          });

          expect(result.content[0].text).toContain('Backup created');
          expect(fs.existsSync(outputFile)).toBe(true);
        } finally {
          if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
          }
        }
      }, 60000);
    });

    describe('MySQL', () => {
      it('should backup MySQL database', async () => {
        const shouldSkip = !process.env.TEST_MYSQL_HOST;
        if (shouldSkip) {
          console.log('Skipping: TEST_MYSQL_HOST not set');
          return;
        }

        const tool = dbTools[0]!;
        const outputFile = '/tmp/test-mysql-backup.sql';

        try {
          const result = await tool.handler({
            action: 'backup',
            dbType: 'mysql',
            host: process.env.TEST_MYSQL_HOST,
            port: parseInt(process.env.TEST_MYSQL_PORT || '3306'),
            user: process.env.TEST_MYSQL_USER,
            password: process.env.TEST_MYSQL_PASSWORD,
            database: process.env.TEST_MYSQL_DATABASE,
            outputPath: outputFile,
          });

          expect(result.content[0].text).toContain('Backup created');
          expect(fs.existsSync(outputFile)).toBe(true);
        } finally {
          if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
          }
        }
      }, 60000);
    });
  });
});
