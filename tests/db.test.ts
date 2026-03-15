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
    const closeTool = dbTools.find((t: { name: string }) => t.name === 'db_closeConnections');
    if (closeTool) {
      await closeTool.handler({});
    } else {
      console.log(
        'Available DB tools:',
        dbTools.map((t: { name: string }) => t.name),
      );
    }

    // Clean up test files
    if (fs.existsSync(testSqlitePath)) {
      fs.unlinkSync(testSqlitePath);
    }
  });

  describe('SQLite Tools', () => {
    describe('db_querySQLite', () => {
      it('should create table and insert data', async () => {
        const tool = dbTools.find((t: { name: string }) => t.name === 'db_querySQLite');
        expect(tool).toBeDefined();

        // Create table
        await tool!.handler({
          dbPath: testSqlitePath,
          query: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
        });

        // Insert data
        await tool!.handler({
          dbPath: testSqlitePath,
          query: "INSERT INTO users (name, email) VALUES ('John Doe', 'john@example.com')",
        });

        // Query data
        const result = await tool!.handler({
          dbPath: testSqlitePath,
          query: 'SELECT * FROM users',
        });

        const response = JSON.parse(result.content[0].text);
        expect(response.rowCount).toBe(1);
        expect(response.rows[0].name).toBe('John Doe');
        expect(response.rows[0].email).toBe('john@example.com');
      });

      it('should handle multiple queries', async () => {
        const tool = dbTools.find((t: { name: string }) => t.name === 'db_querySQLite');

        // Setup
        await tool!.handler({
          dbPath: testSqlitePath,
          query: 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)',
        });

        // Insert multiple rows
        await tool!.handler({
          dbPath: testSqlitePath,
          query: "INSERT INTO products (name, price) VALUES ('Product 1', 10.99)",
        });
        await tool!.handler({
          dbPath: testSqlitePath,
          query: "INSERT INTO products (name, price) VALUES ('Product 2', 20.50)",
        });

        // Query all
        const result = await tool!.handler({
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
        const queryTool = dbTools.find((t: { name: string }) => t.name === 'db_querySQLite');
        const listTool = dbTools.find((t: { name: string }) => t.name === 'db_listSQLiteTables');

        // Create test tables
        await queryTool!.handler({
          dbPath: testSqlitePath,
          query: 'CREATE TABLE table1 (id INTEGER PRIMARY KEY)',
        });
        await queryTool!.handler({
          dbPath: testSqlitePath,
          query: 'CREATE TABLE table2 (id INTEGER PRIMARY KEY)',
        });

        const result = await listTool!.handler({ dbPath: testSqlitePath });

        const response = JSON.parse(result.content[0].text);
        expect(response.count).toBe(2);
        expect(response.tables).toHaveLength(2);

        const tableNames = response.tables.map((t: { name?: string }) => t.name);
        expect(tableNames).toContain('table1');
        expect(tableNames).toContain('table2');
      });

      it('should exclude sqlite internal tables', async () => {
        const queryTool = dbTools.find((t: { name: string }) => t.name === 'db_querySQLite');
        const listTool = dbTools.find((t: { name: string }) => t.name === 'db_listSQLiteTables');

        // Create a user table
        await queryTool!.handler({
          dbPath: testSqlitePath,
          query: 'CREATE TABLE my_table (id INTEGER PRIMARY KEY)',
        });

        const result = await listTool!.handler({ dbPath: testSqlitePath });

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

        const tool = dbTools.find((t: { name: string }) => t.name === 'db_queryPostgres');

        const result = await tool!.handler({
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

        const tool = dbTools.find((t: { name: string }) => t.name === 'db_listPostgresTables');

        const result = await tool!.handler({
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

        const tool = dbTools.find((t: { name: string }) => t.name === 'db_getTableSchema');

        // Assuming there's a test table, or create one first
        const result = await tool!.handler({
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

        const tool = dbTools.find((t: { name: string }) => t.name === 'db_queryMySQL');

        const result = await tool!.handler({
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

        const tool = dbTools.find((t: { name: string }) => t.name === 'db_listMySQLTables');

        const result = await tool!.handler(mysqlConfig);

        const response = JSON.parse(result.content[0].text);
        expect(response.tables).toBeInstanceOf(Array);
      });
    });
  });

  describe('Connection Management', () => {
    describe('db_closeConnections', () => {
      it('should close all connection pools', async () => {
        const tool = dbTools.find((t: { name: string }) => t.name === 'db_closeConnections');

        const result = await tool!.handler({});

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

        const tool = dbTools.find((t: { name: string }) => t.name === 'db_backupPostgres');
        const outputFile = '/tmp/test-pg-backup.sql';

        try {
          const result = await tool!.handler({
            connectionString: pgConnectionString,
            outputFile,
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

        const tool = dbTools.find((t: { name: string }) => t.name === 'db_backupMySQL');
        const outputFile = '/tmp/test-mysql-backup.sql';

        try {
          const result = await tool!.handler({
            host: process.env.TEST_MYSQL_HOST,
            port: parseInt(process.env.TEST_MYSQL_PORT || '3306'),
            user: process.env.TEST_MYSQL_USER,
            password: process.env.TEST_MYSQL_PASSWORD,
            database: process.env.TEST_MYSQL_DATABASE,
            outputFile,
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
