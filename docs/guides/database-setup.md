# HakanMCP — Database Setup Guide

HakanMCP supports five database systems: PostgreSQL, MySQL, Microsoft SQL Server, SQLite, and MongoDB. Each has dedicated tools for querying, schema inspection, and backup/restore.

---

## PostgreSQL

### Tools
- `db_queryPostgres` -- Execute SQL queries
- `db_listPostgresTables` -- List tables
- `db_getTableSchema` -- View column definitions
- `db_backupPostgres` -- Backup via pg_dump
- `db_restorePostgres` -- Restore via psql

### Connection

All PostgreSQL tools accept a `connectionString` parameter:

```
postgresql://username:password@hostname:5432/database_name
```

**Examples:**
```
postgresql://admin:secret@localhost:5432/myapp
postgresql://readonly:pass@db.example.com:5432/production?sslmode=require
```

### Connection Pooling

Connections are automatically pooled by the `dbPoolManager`. Multiple calls with the same connection string reuse the same pool. Use `db_getPoolStats` to view pool statistics and `db_closeConnections` to clean up.

### Backup/Restore

Requires `pg_dump` and `psql` CLI tools installed and in PATH:

```json
// Backup
{ "name": "db_backupPostgres", "arguments": {
  "connectionString": "postgresql://user:pass@localhost:5432/mydb",
  "outputFile": "./backups/mydb-backup.sql"
}}

// Restore
{ "name": "db_restorePostgres", "arguments": {
  "connectionString": "postgresql://user:pass@localhost:5432/mydb",
  "inputFile": "./backups/mydb-backup.sql"
}}
```

---

## MySQL

### Tools
- `db_queryMySQL` -- Execute SQL queries
- `db_listMySQLTables` -- List tables
- `db_getTableSchema` -- View column definitions (with `dbType: "mysql"`)
- `db_backupMySQL` -- Backup via mysqldump
- `db_restoreMySQL` -- Restore via mysql

### Connection

MySQL tools accept individual connection parameters:

```json
{
  "host": "localhost",
  "port": 3306,
  "user": "root",
  "password": "secret",
  "database": "myapp"
}
```

### Backup/Restore

Requires `mysqldump` and `mysql` CLI tools installed and in PATH:

```json
// Backup
{ "name": "db_backupMySQL", "arguments": {
  "host": "localhost",
  "user": "root",
  "password": "secret",
  "database": "myapp",
  "outputFile": "./backups/mydb-backup.sql"
}}
```

The password is passed via `MYSQL_PWD` environment variable (not on command line) for security.

---

## Microsoft SQL Server (MSSQL)

### Tools
- `db_queryMSSQL` -- Execute SQL queries
- `db_listMSSQLTables` -- List tables
- `db_getMSSQLTableSchema` -- View column definitions
- `db_backupMSSQL` -- Backup via T-SQL BACKUP command
- `db_restoreMSSQL` -- Restore via T-SQL RESTORE command

### Connection

MSSQL tools accept individual connection parameters:

```json
{
  "server": "localhost",
  "port": 1433,
  "database": "myapp",
  "user": "sa",
  "password": "YourStrong!Password",
  "encrypt": true,
  "trustServerCertificate": false
}
```

### Common Connection Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `encrypt` | `true` | Enable encrypted connection |
| `trustServerCertificate` | `false` | Trust self-signed certs (set `true` for dev) |
| `port` | `1433` | SQL Server port |

### Backup/Restore

Uses T-SQL commands (runs on the SQL Server itself):

```json
// Backup
{ "name": "db_backupMSSQL", "arguments": {
  "server": "localhost",
  "database": "myapp",
  "user": "sa",
  "password": "YourStrong!Password",
  "backupPath": "C:\\Backups\\myapp.bak",
  "trustServerCertificate": true
}}
```

Note: `backupPath` is a path **on the SQL Server machine**, not the local machine.

---

## SQLite

### Tools
- `db_querySQLite` -- Execute SQL queries
- `db_listSQLiteTables` -- List tables

### Connection

SQLite tools accept a file path:

```json
{
  "dbPath": "./data/myapp.db"
}
```

SQLite databases are file-based -- no server required. The file is opened, queried, and closed per invocation.

### Example

```json
{ "name": "db_querySQLite", "arguments": {
  "dbPath": "./data/app.sqlite3",
  "query": "SELECT * FROM users LIMIT 10"
}}
```

---

## MongoDB

### Tools
- `mongo_connect` -- Establish connection (returns connectionId)
- `mongo_find` -- Query documents
- `mongo_insertOne` / `mongo_insertMany` -- Insert documents
- `mongo_updateOne` / `mongo_updateMany` -- Update documents
- `mongo_deleteOne` / `mongo_deleteMany` -- Delete documents
- `mongo_countDocuments` -- Count documents
- `mongo_aggregate` -- Aggregation pipeline
- `mongo_createIndex` -- Create indexes
- `mongo_listCollections` -- List collections
- `mongo_listDatabases` -- List databases
- `mongo_disconnect` -- Close connection

### Connection

MongoDB uses a two-step connection process:

**Step 1: Connect**
```json
{ "name": "mongo_connect", "arguments": {
  "url": "mongodb://localhost:27017",
  "database": "myapp"
}}
```

Returns a `connectionId` to use in subsequent calls.

**Step 2: Use the connection**
```json
{ "name": "mongo_find", "arguments": {
  "connectionId": "conn_abc123",
  "collection": "users",
  "filter": { "active": true },
  "limit": 10
}}
```

### Default URL

The default MongoDB URL is configured in `config.yaml`:
```yaml
mongoDbUrl: mongodb://localhost:27017
```

### Aggregation Example

```json
{ "name": "mongo_aggregate", "arguments": {
  "connectionId": "conn_abc123",
  "collection": "orders",
  "pipeline": [
    { "$match": { "status": "completed" } },
    { "$group": { "_id": "$customerId", "total": { "$sum": "$amount" } } },
    { "$sort": { "total": -1 } },
    { "$limit": 10 }
  ]
}}
```

---

## Database Query Monitoring

HakanMCP includes tools for monitoring database query performance:

- `db_recordQuery` -- Record query duration for tracking
- `db_slowQueries` -- Find queries exceeding a threshold
- `db_queryStats` -- View p95/p99 query durations
- `db_clearStats` -- Reset monitoring data

### Example

```json
// Record a query duration
{ "name": "db_recordQuery", "arguments": {
  "queryName": "get_user_orders",
  "durationMs": 245
}}

// Find slow queries (> 500ms)
{ "name": "db_slowQueries", "arguments": {
  "thresholdMs": 500
}}
```

---

## Connection Pool Management

Use these tools to manage database connections:

```json
// View pool statistics
{ "name": "db_getPoolStats" }

// Close all pools (graceful cleanup)
{ "name": "db_closeConnections" }
```

Pool stats show active connections, idle count, and total pools per database type (PostgreSQL, MySQL, MSSQL).
