# HakanMCP — Tool Catalog

Complete catalog of all 203 MCP tools organized by category.

---

## AI (8 tools)

### ai_chat
**Category:** AI
**Description:** Chat with AI with conversation history. Auto fallback: Codex, Claude, Gemini CLI/API, Cursor CLI, Ollama.
**Parameters:**
- `message` (string, optional) -- Single message to send. Automatically managed with conversation history.
- `messages` (array, optional) -- Direct messages array (bypasses conversation history). Each item: `{role, content}`.
- `model` (string, optional) -- Model name override.
- `allowLocalFallback` (boolean, optional) -- Allow Ollama fallback. Default: from config.

### ai_generate
**Category:** AI
**Description:** Generate text with AI (Ollama local models).
**Parameters:**
- `prompt` (string, required) -- The text prompt to generate from.
- `model` (string, optional) -- Model name override.

### ai_listModels
**Category:** AI
**Description:** List available AI models from Ollama.
**Parameters:** None

### ai_history
**Category:** AI
**Description:** Get current conversation history.
**Parameters:**
- `limit` (number, optional) -- Maximum number of messages to return.

### ai_clear_history
**Category:** AI
**Description:** Clear conversation history.
**Parameters:** None

### codex_chat
**Category:** AI Provider
**Description:** OpenAI Codex based chat/command execution. Prioritized for code generation and analysis.
**Parameters:**
- `message` (string, required) -- Message to send.
- `model` (string, optional) -- Model name.

### claude_code_chat
**Category:** AI Provider
**Description:** Claude Code (Anthropic) based chat. Optimized for code-oriented tasks.
**Parameters:**
- `message` (string, required) -- Message to send.
- `model` (string, optional) -- Model name.

### gemini_chat
**Category:** AI Provider
**Description:** Google Gemini based chat with fallback to Codex and Claude.
**Parameters:**
- `message` (string, required) -- Message to send.
- `model` (string, optional) -- Model name.

---

## Database (22 tools)

### db_queryPostgres
**Category:** Database
**Description:** Runs queries against the PostgreSQL database.
**Parameters:**
- `connectionString` (string, required) -- PostgreSQL connection string.
- `query` (string, required) -- SQL query.

### db_queryMySQL
**Category:** Database
**Description:** Runs queries against the MySQL database.
**Parameters:**
- `host` (string, required) -- MySQL host.
- `user` (string, required) -- Username.
- `password` (string, required) -- Password.
- `database` (string, required) -- Database name.
- `query` (string, required) -- SQL query.
- `port` (number, optional) -- Port (default: 3306).

### db_queryMSSQL
**Category:** Database
**Description:** Runs a query against a Microsoft SQL Server database.
**Parameters:**
- `server` (string, required) -- SQL Server host.
- `database` (string, required) -- Database name.
- `user` (string, required) -- Username.
- `password` (string, required) -- Password.
- `query` (string, required) -- SQL query.
- `port` (number, optional) -- Port (default: 1433).
- `encrypt` (boolean, optional) -- Encrypted connection (default: true).
- `trustServerCertificate` (boolean, optional) -- Trust server certificate (default: false).

### db_querySQLite
**Category:** Database
**Description:** Runs queries against SQLite database.
**Parameters:**
- `dbPath` (string, required) -- Path to SQLite database file.
- `query` (string, required) -- SQL query.

### db_listPostgresTables
**Category:** Database
**Description:** Lists tables in the PostgreSQL database.
**Parameters:**
- `connectionString` (string, required) -- PostgreSQL connection string.

### db_listMySQLTables
**Category:** Database
**Description:** Lists tables in the MySQL database.
**Parameters:**
- `host` (string, required), `user` (string, required), `password` (string, required), `database` (string, required), `port` (number, optional)

### db_listMSSQLTables
**Category:** Database
**Description:** Lists tables in the MSSQL database.
**Parameters:**
- `server` (string, required), `database` (string, required), `user` (string, required), `password` (string, required), `port` (number, optional), `encrypt` (boolean, optional), `trustServerCertificate` (boolean, optional)

### db_listSQLiteTables
**Category:** Database
**Description:** Lists tables in the SQLite database.
**Parameters:**
- `dbPath` (string, required) -- Path to SQLite file.

### db_getTableSchema
**Category:** Database
**Description:** Displays table schema (PostgreSQL/MySQL).
**Parameters:**
- `dbType` (string, required) -- `"postgres"` or `"mysql"`.
- `tableName` (string, required) -- Table name.
- `connectionString` (string, optional) -- For PostgreSQL.
- `host`, `user`, `password`, `database`, `port` (optional) -- For MySQL.

### db_getMSSQLTableSchema
**Category:** Database
**Description:** Shows the schema of an MSSQL table.
**Parameters:**
- `server` (string, required), `database` (string, required), `user` (string, required), `password` (string, required), `tableName` (string, required), `schema` (string, optional, default: "dbo"), `port` (number, optional), `encrypt` (boolean, optional), `trustServerCertificate` (boolean, optional)

### db_backupPostgres
**Category:** Database
**Description:** Backs up PostgreSQL database using pg_dump.
**Parameters:**
- `connectionString` (string, required), `outputFile` (string, required)

### db_restorePostgres
**Category:** Database
**Description:** Restores PostgreSQL database using psql.
**Parameters:**
- `connectionString` (string, required), `inputFile` (string, required)

### db_backupMySQL
**Category:** Database
**Description:** Backs up MySQL database using mysqldump.
**Parameters:**
- `host` (string, required), `user` (string, required), `password` (string, required), `database` (string, required), `outputFile` (string, required), `port` (number, optional)

### db_restoreMySQL
**Category:** Database
**Description:** Restores MySQL database.
**Parameters:**
- `host` (string, required), `user` (string, required), `password` (string, required), `database` (string, required), `inputFile` (string, required), `port` (number, optional)

### db_backupMSSQL
**Category:** Database
**Description:** Backs up MSSQL database using T-SQL BACKUP command.
**Parameters:**
- `server` (string, required), `database` (string, required), `user` (string, required), `password` (string, required), `backupPath` (string, required), `port` (number, optional), `encrypt` (boolean, optional), `trustServerCertificate` (boolean, optional)

### db_restoreMSSQL
**Category:** Database
**Description:** Restores MSSQL database using T-SQL RESTORE command.
**Parameters:**
- `server` (string, required), `database` (string, required), `user` (string, required), `password` (string, required), `backupPath` (string, required), `port` (number, optional), `encrypt` (boolean, optional), `trustServerCertificate` (boolean, optional)

### db_closeConnections
**Category:** Database
**Description:** Closes all database connection pools.
**Parameters:** None

### db_getPoolStats
**Category:** Database
**Description:** Shows statistics of active database connection pools.
**Parameters:** None

### db_recordQuery
**Category:** Database Monitoring
**Description:** Records the duration of a query (ms) for monitoring.
**Parameters:**
- `queryName` (string, required), `durationMs` (number, required)

### db_slowQueries
**Category:** Database Monitoring
**Description:** Lists slow queries above threshold.
**Parameters:**
- `thresholdMs` (number, optional)

### db_queryStats
**Category:** Database Monitoring
**Description:** Total query count and p95/p99 percentiles.
**Parameters:** None

### db_clearStats
**Category:** Database Monitoring
**Description:** Clears saved query statistics.
**Parameters:** None

---

## MongoDB (14 tools)

### mongo_connect
**Category:** MongoDB
**Description:** Connect to MongoDB database. Returns a connection ID.
**Parameters:**
- `url` (string, required) -- MongoDB connection URL.
- `database` (string, required) -- Database name.

### mongo_find
**Category:** MongoDB
**Description:** Find documents from a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `filter` (object, optional), `projection` (object, optional), `limit` (number, optional), `sort` (object, optional)

### mongo_insertOne
**Category:** MongoDB
**Description:** Add a single document to a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `document` (object, required)

### mongo_insertMany
**Category:** MongoDB
**Description:** Add multiple documents to a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `documents` (array, required)

### mongo_updateOne
**Category:** MongoDB
**Description:** Update a single document in a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `filter` (object, required), `update` (object, required)

### mongo_updateMany
**Category:** MongoDB
**Description:** Update multiple documents in a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `filter` (object, required), `update` (object, required)

### mongo_deleteOne
**Category:** MongoDB
**Description:** Delete a single document from a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `filter` (object, required)

### mongo_deleteMany
**Category:** MongoDB
**Description:** Delete multiple documents from a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `filter` (object, required)

### mongo_countDocuments
**Category:** MongoDB
**Description:** Count documents matching a filter.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `filter` (object, optional)

### mongo_aggregate
**Category:** MongoDB
**Description:** Run MongoDB aggregation pipeline.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `pipeline` (array, required)

### mongo_createIndex
**Category:** MongoDB
**Description:** Create an index on a collection.
**Parameters:**
- `connectionId` (string, required), `collection` (string, required), `keys` (object, required), `options` (object, optional)

### mongo_listCollections
**Category:** MongoDB
**Description:** List collections in a database.
**Parameters:**
- `connectionId` (string, required)

### mongo_listDatabases
**Category:** MongoDB
**Description:** List all databases on the MongoDB server.
**Parameters:**
- `connectionId` (string, required)

### mongo_disconnect
**Category:** MongoDB
**Description:** Close the MongoDB connection.
**Parameters:**
- `connectionId` (string, required)

---

## Git (11 tools)

### git_status
**Category:** Git
**Description:** Shows Git repository status.
**Parameters:**
- `repoPath` (string, optional) -- Repository path (default: cwd).

### git_log
**Category:** Git
**Description:** Shows the latest commits.
**Parameters:**
- `repoPath` (string, optional), `maxCount` (number, optional, default: 10)

### git_diff
**Category:** Git
**Description:** Shows unstaged changes.
**Parameters:**
- `repoPath` (string, optional)

### git_branch
**Category:** Git
**Description:** Lists branches.
**Parameters:**
- `repoPath` (string, optional)

### git_add
**Category:** Git
**Description:** Stages files for commit.
**Parameters:**
- `files` (array of strings, required), `repoPath` (string, optional)

### git_commit
**Category:** Git
**Description:** Creates a commit.
**Parameters:**
- `message` (string, required), `repoPath` (string, optional)

### git_push
**Category:** Git
**Description:** Pushes changes to remote.
**Parameters:**
- `remote` (string, optional, default: "origin"), `branch` (string, optional), `repoPath` (string, optional)

### git_pull
**Category:** Git
**Description:** Pulls changes from remote.
**Parameters:**
- `remote` (string, optional, default: "origin"), `branch` (string, optional), `repoPath` (string, optional)

### git_checkout
**Category:** Git
**Description:** Changes branch or creates a new branch.
**Parameters:**
- `branch` (string, required), `create` (boolean, optional, default: false), `repoPath` (string, optional)

### git_reset
**Category:** Git
**Description:** Reset operations (soft, mixed, hard).
**Parameters:**
- `mode` (string, required) -- `"soft"`, `"mixed"`, or `"hard"`.
- `target` (string, optional, default: "HEAD"), `repoPath` (string, optional)

### git_clone
**Category:** Git
**Description:** Clones a repository.
**Parameters:**
- `remoteUrl` (string, required), `destination` (string, required)

---

## GitHub (5 tools)

### github_setupRemote
**Category:** GitHub
**Description:** Configures GitHub remote repository (uses token for private repo).
**Parameters:**
- `owner` (string, optional), `repo` (string, optional)

### github_push
**Category:** GitHub
**Description:** Pushes changes to GitHub for backup.
**Parameters:**
- `owner` (string, optional), `repo` (string, optional)

### github_pull
**Category:** GitHub
**Description:** Pulls latest changes from GitHub.
**Parameters:**
- `owner` (string, optional), `repo` (string, optional)

### github_status
**Category:** GitHub
**Description:** Shows GitHub sync status (ahead/behind commits).
**Parameters:**
- `owner` (string, optional), `repo` (string, optional)

### github_createRepo
**Category:** GitHub
**Description:** Creates a private repository on GitHub (requires `gh` CLI).
**Parameters:**
- `owner` (string, optional), `repo` (string, optional)

---

## HTTP (6 tools)

### http_request
**Category:** HTTP
**Description:** Sends HTTP requests (GET, POST, PUT, DELETE, etc.).
**Parameters:**
- `url` (string, required), `method` (string, optional, default: "GET"), `headers` (object, optional), `body` (string/object, optional)

### http_withBearer
**Category:** HTTP
**Description:** Sends HTTP request with Bearer token authentication.
**Parameters:**
- `url` (string, required), `token` (string, required), `method` (string, optional), `headers` (object, optional), `body` (optional)

### http_withBasicAuth
**Category:** HTTP
**Description:** Sends HTTP request with Basic authentication.
**Parameters:**
- `url` (string, required), `username` (string, required), `password` (string, required), `method` (string, optional), `headers` (object, optional), `body` (optional)

### http_withApiKey
**Category:** HTTP
**Description:** Sends HTTP request with API Key authentication.
**Parameters:**
- `url` (string, required), `apiKey` (string, required), `headerName` (string, optional), `method` (string, optional), `headers` (object, optional), `body` (optional)

### http_requestWithTimeout
**Category:** HTTP
**Description:** Sends HTTP requests with timeout and retry support.
**Parameters:**
- `url` (string, required), `method` (string, optional), `timeout` (number, optional), `retries` (number, optional), `headers` (object, optional), `body` (optional)

### http_downloadFile
**Category:** HTTP
**Description:** Downloads a file from URL and saves it.
**Parameters:**
- `url` (string, required), `outputPath` (string, required)

---

## System & Filesystem (17 tools)

### fs_listDir
**Category:** Filesystem
**Description:** Lists directory contents.
**Parameters:**
- `path` (string, required)

### fs_readFile
**Category:** Filesystem
**Description:** Reads file content (UTF-8).
**Parameters:**
- `path` (string, required)

### fs_writeFile
**Category:** Filesystem
**Description:** Writes text to file.
**Parameters:**
- `path` (string, required), `content` (string, required)

### fs_deleteFile
**Category:** Filesystem
**Description:** Deletes a file or directory.
**Parameters:**
- `path` (string, required)

### fs_moveFile
**Category:** Filesystem
**Description:** Moves or renames a file/directory.
**Parameters:**
- `source` (string, required), `destination` (string, required)

### fs_copyFile
**Category:** Filesystem
**Description:** Copies a file or directory.
**Parameters:**
- `source` (string, required), `destination` (string, required)

### fs_makeDir
**Category:** Filesystem
**Description:** Creates a new directory.
**Parameters:**
- `path` (string, required)

### fs_searchFiles
**Category:** Filesystem
**Description:** Searches files using glob patterns.
**Parameters:**
- `pattern` (string, required), `cwd` (string, optional)

### sys_runCommand
**Category:** System
**Description:** Runs a shell command.
**Parameters:**
- `command` (string, required), `cwd` (string, optional), `timeout` (number, optional)

### sys_listProcesses
**Category:** System
**Description:** Lists running processes (tasklist/ps).
**Parameters:** None

### sys_killProcess
**Category:** System
**Description:** Terminates a process by PID.
**Parameters:**
- `pid` (number, required)

### sys_listProcessByName
**Category:** System
**Description:** Lists running processes by name with details.
**Parameters:**
- `name` (string, required)

### sys_killProcessByName
**Category:** System
**Description:** Kills all processes by name (e.g., node.exe, chrome.exe).
**Parameters:**
- `name` (string, required)

### sys_uninstallApp
**Category:** System
**Description:** Uninstalls a Windows application by name.
**Parameters:**
- `appName` (string, required)

### sys_listScheduledTasks
**Category:** System
**Description:** Lists scheduled tasks (schtasks/crontab).
**Parameters:** None

### sys_runScheduledTask
**Category:** System
**Description:** Runs a scheduled task.
**Parameters:**
- `taskName` (string, required)

### sys_getSystemInfo
**Category:** System
**Description:** Returns system information (OS, CPU, RAM, uptime).
**Parameters:** None

---

## System Optimization (16 tools)

### sysopt_run_main_panel
**Category:** SysOpt
**Description:** Launches the main optimization panel as administrator.
**Parameters:** None

### sysopt_analyze_system
**Category:** SysOpt
**Description:** Comprehensive system analysis (CPU, RAM, Disk, GPU, Services, Startup, Browser Cache, Network).
**Parameters:**
- `detailed` (boolean, optional)

### sysopt_auto_cleanup
**Category:** SysOpt
**Description:** Automatic system cleaning (Temp, Cache, Browser, Windows Update, Event Logs, Thumbnail Cache).
**Parameters:** None

### sysopt_ram_cleanup
**Category:** SysOpt
**Description:** Cleans and optimizes RAM (Standby memory, DNS cache, Event logs, Temp files).
**Parameters:** None

### sysopt_docker_cleanup
**Category:** SysOpt
**Description:** Docker cleanup (Container, Image, Volume, Build Cache).
**Parameters:** None

### sysopt_registry_optimize
**Category:** SysOpt
**Description:** Registry optimization (Visual Effects, Menu Delay, Explorer, Telemetry, Network Throttling, Game Mode).
**Parameters:** None

### sysopt_network_optimize
**Category:** SysOpt
**Description:** Network performance optimization (DNS, TCP/IP, Nagle algorithm, Network throttling, ARP cache).
**Parameters:** None

### sysopt_gaming_optimize
**Category:** SysOpt
**Description:** Game performance optimization (Game Mode, Mouse acceleration, Fullscreen optimizations, Power plan, GPU).
**Parameters:** None

### sysopt_ssd_optimize
**Category:** SysOpt
**Description:** SSD optimization (TRIM, Superfetch, Prefetch, Indexing, Last Access Time).
**Parameters:** None

### sysopt_performance_optimize
**Category:** SysOpt
**Description:** General performance optimization (Visual effects, Explorer, Search indexing, Disk cleanup, Power settings).
**Parameters:** None

### sysopt_startup_optimize
**Category:** SysOpt
**Description:** Optimizes startup programs.
**Parameters:** None

### sysopt_service_optimize
**Category:** SysOpt
**Description:** Permanently optimizes system services (ADMIN REQUIRED).
**Parameters:** None

### sysopt_create_scheduled_tasks
**Category:** SysOpt
**Description:** Creates scheduled tasks for weekly cleaning and daily RAM optimization (ADMIN REQUIRED).
**Parameters:** None

### sysopt_quick_status
**Category:** SysOpt
**Description:** Quick system status summary (CPU, RAM, Disk usage).
**Parameters:** None

### sysopt_full_optimize
**Category:** SysOpt
**Description:** Runs all optimizations at once (Analysis + Cleaning + RAM + Registry + Network + SSD + Gaming + Performance).
**Parameters:** None

### sysopt_view_logs
**Category:** SysOpt
**Description:** Displays optimization log files.
**Parameters:** None

---

## Backup (7 tools)

### backup_create
**Category:** Backup
**Description:** Creates an immediate ZIP backup of the MCP server directory.
**Parameters:** None

### backup_list
**Category:** Backup
**Description:** Lists all available backups.
**Parameters:** None

### backup_restore
**Category:** Backup
**Description:** Restores from a specified backup.
**Parameters:**
- `backupFile` (string, required) -- Backup filename to restore.

### backup_getStats
**Category:** Backup
**Description:** Shows backup system statistics.
**Parameters:** None

### backup_start
**Category:** Backup
**Description:** Starts the automatic backup service.
**Parameters:** None

### backup_stop
**Category:** Backup
**Description:** Stops the automatic backup service.
**Parameters:** None

### backup_deleteOld
**Category:** Backup
**Description:** Deletes backups older than specified hours.
**Parameters:**
- `hours` (number, optional) -- Age threshold in hours.

---

## Scheduler (10 tools)

### scheduler_createTask
**Category:** Scheduler
**Description:** Creates a new scheduled task in cron format.
**Parameters:**
- `name` (string, required), `schedule` (string, required) -- Cron expression, `agentTask` (string, required), `enabled` (boolean, optional)

### scheduler_listTasks
**Category:** Scheduler
**Description:** Lists all scheduled tasks (active and inactive).
**Parameters:** None

### scheduler_getTask
**Category:** Scheduler
**Description:** Gets details of a specific task.
**Parameters:**
- `taskId` (string, required)

### scheduler_updateTask
**Category:** Scheduler
**Description:** Updates an existing task.
**Parameters:**
- `taskId` (string, required), `schedule` (string, optional), `agentTask` (string, optional), `enabled` (boolean, optional)

### scheduler_deleteTask
**Category:** Scheduler
**Description:** Deletes a scheduled task.
**Parameters:**
- `taskId` (string, required)

### scheduler_pauseTask
**Category:** Scheduler
**Description:** Pauses a task (schedule preserved, becomes inactive).
**Parameters:**
- `taskId` (string, required)

### scheduler_resumeTask
**Category:** Scheduler
**Description:** Resumes a paused task.
**Parameters:**
- `taskId` (string, required)

### scheduler_executeNow
**Category:** Scheduler
**Description:** Runs a task immediately (one-time manual run).
**Parameters:**
- `taskId` (string, required)

### scheduler_getHistory
**Category:** Scheduler
**Description:** Views task run history.
**Parameters:**
- `taskId` (string, optional), `limit` (number, optional)

### scheduler_getStats
**Category:** Scheduler
**Description:** Views scheduler statistics.
**Parameters:** None

---

## Monitoring (7 tools)

### monitor_healthCheck
**Category:** Monitoring
**Description:** Performs health check for a specified instance (file existence, build status).
**Parameters:**
- `instancePath` (string, optional), `issueType` (string, optional)

### monitor_autoHeal
**Category:** Monitoring
**Description:** Automatically fixes corrupted instance from healthy instance.
**Parameters:**
- `brokenInstance` (string, required), `healthyInstance` (string, required), `issueType` (string, optional)

### monitor_compare
**Category:** Monitoring
**Description:** Compares two instances. Use deep=true for SHA-256 full-tree comparison.
**Parameters:**
- `instance1` (string, required), `instance2` (string, required), `deep` (boolean, optional)

### monitor_sync
**Category:** Monitoring
**Description:** Synchronizes changes from main to second instance.
**Parameters:**
- `source` (string, required), `target` (string, required), `deep` (boolean, optional)

### monitor_updateDependencies
**Category:** Monitoring
**Description:** Automatic dependency updates with testing and optional commit.
**Parameters:**
- `instancePath` (string, optional), `autoCommit` (boolean, optional)

### monitor_selfRecover
**Category:** Monitoring
**Description:** Automatic recovery from common errors (port conflict, out of memory, db connection lost).
**Parameters:**
- `errorType` (string, optional)

### monitor_rollback
**Category:** Monitoring
**Description:** Reverts instance to last known good state (git reset + npm ci + build).
**Parameters:**
- `instancePath` (string, optional)

---

## Cache (5 tools)

### cache_set
**Category:** Cache
**Description:** Write a value into cache (TTL optional).
**Parameters:**
- `key` (string, required), `value` (any, required), `ttl` (number, optional) -- TTL in seconds.

### cache_get
**Category:** Cache
**Description:** Read a value from cache.
**Parameters:**
- `key` (string, required)

### cache_delete
**Category:** Cache
**Description:** Delete a key from cache.
**Parameters:**
- `key` (string, required)

### cache_clear
**Category:** Cache
**Description:** Clear all cache entries.
**Parameters:** None

### cache_stats
**Category:** Cache
**Description:** Returns cache statistics (hits, misses, keys).
**Parameters:** None

---

## Environment (6 tools)

### env_getVar
**Category:** Environment
**Description:** Reads an environment variable.
**Parameters:**
- `name` (string, required)

### env_setVar
**Category:** Environment
**Description:** Sets an environment variable (current process only).
**Parameters:**
- `name` (string, required), `value` (string, required)

### env_listVars
**Category:** Environment
**Description:** Lists all environment variables.
**Parameters:** None

### env_loadFromFile
**Category:** Environment
**Description:** Loads environment variables from a .env file.
**Parameters:**
- `filePath` (string, optional)

### env_saveToFile
**Category:** Environment
**Description:** Saves current environment variables to a .env file.
**Parameters:**
- `filePath` (string, optional), `keys` (array of strings, optional) -- Specific keys to save.

### env_deleteVar
**Category:** Environment
**Description:** Deletes an environment variable.
**Parameters:**
- `name` (string, required)

---

## Encryption (4 tools)

### encrypt_value
**Category:** Encryption
**Description:** Encrypts sensitive data (token, password, API key) using AES-256-GCM.
**Parameters:**
- `value` (string, required), `password` (string, optional) -- Uses AI_KEY_PASSWORD env var if not provided.

### decrypt_value
**Category:** Encryption
**Description:** Decrypts encrypted data. Returns the original value.
**Parameters:**
- `encryptedValue` (string, required), `password` (string, optional)

### encrypt_file
**Category:** Encryption
**Description:** Encrypts file content and saves the encrypted version.
**Parameters:**
- `inputPath` (string, required), `outputPath` (string, optional), `password` (string, optional)

### decrypt_file
**Category:** Encryption
**Description:** Decrypts the encrypted file and saves the original content.
**Parameters:**
- `inputPath` (string, required), `outputPath` (string, optional), `password` (string, optional)

---

## Parser (6 tools)

### parse_yaml
**Category:** Parser
**Description:** Parses YAML string and converts to JSON.
**Parameters:**
- `yamlString` (string, required)

### parse_json
**Category:** Parser
**Description:** Parses and validates JSON string.
**Parameters:**
- `jsonString` (string, required)

### parse_xml
**Category:** Parser
**Description:** Parses XML string and converts to JSON.
**Parameters:**
- `xmlString` (string, required)

### parse_csv
**Category:** Parser
**Description:** Parses CSV string and converts to JSON array.
**Parameters:**
- `csvString` (string, required), `delimiter` (string, optional)

### yaml_to_json
**Category:** Parser
**Description:** Reads a YAML file and converts it to a JSON file.
**Parameters:**
- `inputPath` (string, required), `outputPath` (string, required)

### json_to_yaml
**Category:** Parser
**Description:** Reads a JSON file and converts it to a YAML file.
**Parameters:**
- `inputPath` (string, required), `outputPath` (string, required)

---

## Template (2 tools)

### render_template
**Category:** Template
**Description:** Renders a Handlebars template with provided data.
**Parameters:**
- `template` (string, required), `data` (object, required)

### compile_template
**Category:** Template
**Description:** Reads a template file, renders it with data, and writes to a new file.
**Parameters:**
- `inputPath` (string, required), `outputPath` (string, required), `data` (object, required)

---

## GitBook (7 tools)

### getPage
**Category:** GitBook
**Description:** Returns the plain text of a GitBook page (path or full URL).
**Parameters:**
- `path` (string, required)

### listLinks
**Category:** GitBook
**Description:** Lists internal links (href + text) on a GitBook page.
**Parameters:**
- `path` (string, required)

### find
**Category:** GitBook
**Description:** Searches for keyword/regex within a GitBook page.
**Parameters:**
- `path` (string, required), `keyword` (string, required)

### gb_headings
**Category:** GitBook
**Description:** Lists H1-H3 headers on a GitBook page.
**Parameters:**
- `path` (string, required)

### gb_outline
**Category:** GitBook
**Description:** Returns the page title tree (level, text, id).
**Parameters:**
- `path` (string, required)

### gb_getMetadata
**Category:** GitBook
**Description:** Returns metadata (title, description, keywords) of a GitBook page.
**Parameters:**
- `path` (string, required)

### gb_searchContent
**Category:** GitBook
**Description:** Searches for content on a GitBook page and returns it with context.
**Parameters:**
- `path` (string, required), `query` (string, required)

---

## Postman (10 tools)

### pm_listCollections
**Category:** Postman
**Description:** Lists .postman_collection.json files in POSTMAN_DIR.
**Parameters:** None

### pm_listRequests
**Category:** Postman
**Description:** Lists all requests in a selected collection.
**Parameters:**
- `collectionFile` (string, required)

### pm_getRequest
**Category:** Postman
**Description:** Returns a single request by name in a collection.
**Parameters:**
- `collectionFile` (string, required), `requestName` (string, required)

### pm_searchRequests
**Category:** Postman
**Description:** Searches requests by name/URL/HTTP method (regex supported).
**Parameters:**
- `collectionFile` (string, required), `query` (string, required)

### pm_requestToMarkdown
**Category:** Postman
**Description:** Returns a request as formatted Markdown.
**Parameters:**
- `collectionFile` (string, required), `requestName` (string, required)

### pm_updateRequest
**Category:** Postman
**Description:** Updates an existing request in a collection.
**Parameters:**
- `collectionFile` (string, required), `requestName` (string, required), `url` (string, optional), `method` (string, optional), `headers` (object, optional), `body` (object, optional)

### pm_addRequest
**Category:** Postman
**Description:** Adds a new request to a collection.
**Parameters:**
- `collectionFile` (string, required), `requestName` (string, required), `url` (string, required), `method` (string, optional)

### pm_deleteRequest
**Category:** Postman
**Description:** Deletes a request from a collection.
**Parameters:**
- `collectionFile` (string, required), `requestName` (string, required)

### pm_executeRequest
**Category:** Postman
**Description:** Executes a Postman request (actually sends the HTTP request).
**Parameters:**
- `collectionFile` (string, required), `requestName` (string, required)

### pm_cloneRequest
**Category:** Postman
**Description:** Copies an existing request.
**Parameters:**
- `collectionFile` (string, required), `requestName` (string, required), `newName` (string, required)

---

## MCP Client (5 tools)

### mcp_connect
**Category:** MCP
**Description:** Connects to another MCP server.
**Parameters:**
- `command` (string, required), `args` (array, optional), `env` (object, optional)

### mcp_listTools
**Category:** MCP
**Description:** Lists available tools on the connected MCP server.
**Parameters:**
- `connectionId` (string, required)

### mcp_callTool
**Category:** MCP
**Description:** Runs a tool on the connected MCP server.
**Parameters:**
- `connectionId` (string, required), `toolName` (string, required), `arguments` (object, optional)

### mcp_disconnect
**Category:** MCP
**Description:** Closes the MCP server connection.
**Parameters:**
- `connectionId` (string, required)

### mcp_listConnections
**Category:** MCP
**Description:** Lists active MCP connections.
**Parameters:** None

---

## Flow & Connections (11 tools)

### flow_validate
**Category:** Flow
**Description:** Validates a flow/recipe JSON file (trigger/steps/action schema).
**Parameters:**
- `path` (string, required)

### flow_run
**Category:** Flow
**Description:** Runs a flow/recipe JSON file (actions: log, monitor_healthCheck, syncPeerRepo, http_request + connectionId).
**Parameters:**
- `path` (string, required)

### flow_history
**Category:** Flow
**Description:** Lists last flow run history.
**Parameters:**
- `limit` (number, optional)

### flow_replay
**Category:** Flow
**Description:** Reruns the last (or specified) flow record.
**Parameters:**
- `path` (string, optional)

### flow_version_save
**Category:** Flow
**Description:** Makes a version copy of a flow file.
**Parameters:**
- `path` (string, required), `label` (string, optional)

### flow_version_list
**Category:** Flow
**Description:** Lists registered versions for a flow file.
**Parameters:**
- `path` (string, required)

### flow_version_restore
**Category:** Flow
**Description:** Restores a version copy to the selected path.
**Parameters:**
- `path` (string, required), `version` (string, required)

### connection_save
**Category:** Connection
**Description:** Saves a secret connection object for flow/connector (config is masked).
**Parameters:**
- `id` (string, required), `type` (string, required), `config` (object, required)

### connection_list
**Category:** Connection
**Description:** Lists connection objects (config masked).
**Parameters:** None

### connection_get
**Category:** Connection
**Description:** Gets a single connection (optionally with secrets).
**Parameters:**
- `id` (string, required), `includeSecrets` (boolean, optional)

### connection_delete
**Category:** Connection
**Description:** Deletes a connection.
**Parameters:**
- `id` (string, required)

---

## Knowledge Graph (9 tools)

### kg_create_entities
**Category:** Knowledge Graph
**Description:** Create multiple entities in the knowledge graph.
**Parameters:**
- `entities` (array, required) -- Each with `name`, `entityType`, `observations`.

### kg_create_relations
**Category:** Knowledge Graph
**Description:** Create relations between entities in active voice.
**Parameters:**
- `relations` (array, required) -- Each with `from`, `to`, `relationType`.

### kg_add_observations
**Category:** Knowledge Graph
**Description:** Add observations to existing entities.
**Parameters:**
- `observations` (array, required) -- Each with `entityName`, `contents`.

### kg_delete_entities
**Category:** Knowledge Graph
**Description:** Delete entities and their related relations.
**Parameters:**
- `entityNames` (array of strings, required)

### kg_delete_observations
**Category:** Knowledge Graph
**Description:** Delete specific observations from entities.
**Parameters:**
- `deletions` (array, required) -- Each with `entityName`, `observations`.

### kg_delete_relations
**Category:** Knowledge Graph
**Description:** Delete specific relations from the knowledge graph.
**Parameters:**
- `relations` (array, required) -- Each with `from`, `to`, `relationType`.

### kg_read_graph
**Category:** Knowledge Graph
**Description:** Read the complete knowledge graph.
**Parameters:** None

### kg_search
**Category:** Knowledge Graph
**Description:** Search entities and observations in the knowledge graph.
**Parameters:**
- `query` (string, required)

### kg_open_nodes
**Category:** Knowledge Graph
**Description:** Open specific nodes and relations by entity names.
**Parameters:**
- `names` (array of strings, required)

---

## Self-Improvement (3 tools)

### self_proposeChange
**Category:** Self-Improvement
**Description:** Saves the code change suggested by the AI agent and submits it for approval.
**Parameters:**
- `filePath` (string, required), `changeType` (string, required), `description` (string, required), `code` (string, required)

### self_applyChange
**Category:** Self-Improvement
**Description:** Applies the suggested change and commits if necessary.
**Parameters:**
- `changeId` (string, required), `autoCommit` (boolean, optional)

### self_getChangeLog
**Category:** Self-Improvement
**Description:** Lists all self-improvement changes made to date.
**Parameters:** None

---

## API (4 tools)

### api_openapiSpec
**Category:** API
**Description:** Returns the OpenAPI skeleton for the REST wrapper.
**Parameters:** None

### api_rateLimitStatus
**Category:** API
**Description:** Returns simple rate limit status (token bucket).
**Parameters:** None

### api_webhookHandle
**Category:** API
**Description:** Verifies webhook payload and returns acceptance message.
**Parameters:**
- `payload` (object, required)

### api_restWrapperInfo
**Category:** API
**Description:** Returns REST wrapper installation guide and default port information.
**Parameters:** None

---

## Developer Experience (2 tools)

### dx_toolScaffold
**Category:** DX
**Description:** Produces a TypeScript skeleton for a new tool and optionally writes it to file.
**Parameters:**
- `toolName` (string, required), `description` (string, required), `outputPath` (string, optional)

### dx_hotReloadTip
**Category:** DX
**Description:** Returns hot-reload/dev hints (ts-node/esm).
**Parameters:** None

---

## Performance (1 tool)

### perf_benchmark
**Category:** Performance
**Description:** Runs a simple CPU benchmark (loop).
**Parameters:**
- `iterations` (number, optional)
