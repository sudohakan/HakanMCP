# HakanMCP — Troubleshooting

Common issues and solutions when working with HakanMCP.

---

## Build Issues

### Build fails with TypeScript errors

**Symptom:** `npm run build` fails with compilation errors.

**Solutions:**
1. Verify Node.js version: `node -v` (must be >= 20.0.0)
2. Clean install dependencies:
   ```bash
   rm -rf node_modules dist
   npm install
   npm run build
   ```
3. Check TypeScript version: `npx tsc --version` (should be >= 5.x)
4. If errors reference missing types, ensure all `@types/*` packages are installed:
   ```bash
   npm install
   ```

### `dist/` directory missing or stale

**Symptom:** Runtime errors like `Cannot find module 'dist/src/index.js'`.

**Solution:** Rebuild the project:
```bash
npm run build
```

---

## MCP Server Issues

### MCP server won't start

**Symptom:** No output or immediate exit when running `node dist/src/index.js`.

**Solutions:**
1. Ensure `dist/` exists and is up-to-date: `npm run build`
2. Check `config.yaml` exists and is valid YAML:
   ```bash
   npx hakanmcp doctor
   ```
3. Check for syntax errors in `config.yaml`:
   ```bash
   node -e "const yaml = require('js-yaml'); const fs = require('fs'); yaml.load(fs.readFileSync('config.yaml','utf8')); console.log('OK')"
   ```
4. Check `.env` file for syntax errors (no spaces around `=`, no quotes unless intended)

### Server starts but client shows "no tools"

**Symptom:** Claude Desktop / Claude Code connects but shows 0 tools.

**Solutions:**
1. Ensure the MCP config path in the client is correct and points to `dist/src/index.js`
2. Restart the AI client after config changes
3. Check stderr output for errors:
   ```bash
   node dist/src/index.js 2>error.log
   ```
4. Verify the server works by checking log output for `[INFO] Hakan Personal MCP Server started!`

### "serverName: should-fail" error

**Symptom:** Config validation fails because `serverName` has a test value.

**Solution:** Edit `config.yaml` and set a valid server name:
```yaml
serverName: hakan-mcp
```

---

## AI Chat Issues

### AI chat not responding

**Symptom:** `hakanmcp -d "hello"` or `hakanmcp -c` hangs or returns errors.

**Solutions:**
1. Check if at least one AI provider is available:
   - **CLI providers:** Verify `codex`, `claude`, `gemini`, or `agent` (Cursor) are installed and in PATH
   - **API keys:** Set at least one in `.env`:
     ```env
     CODEX_API_KEY=sk-...
     ANTHROPIC_API_KEY=sk-ant-...
     GEMINI_API_KEY=AI...
     ```
2. Check provider cooldown status:
   ```bash
   npx hakanmcp limits status
   ```
3. Reset cooldowns if all providers are in cooldown:
   ```bash
   npx hakanmcp limits reset
   ```
4. If using Ollama, verify it's running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

### "Local models are disabled" error

**Symptom:** AI tools fail with message about local models being disabled.

**Solution:** Either:
- Set `aiProviders.localModels: true` in `config.yaml`, or
- Provide API keys for cloud providers, or
- Unset `DISABLE_LOCAL_MODELS` environment variable

### All providers failing with rate limit

**Symptom:** Every provider returns a rate limit error.

**Solution:**
1. Wait for cooldown to expire (check with `hakanmcp limits status`)
2. Add API keys for additional providers
3. Reset cooldowns: `hakanmcp limits reset`
4. Set up Ollama as local fallback (no rate limits)

---

## Database Connection Issues

### PostgreSQL connection refused

**Symptom:** `db_queryPostgres` returns connection refused error.

**Solutions:**
1. Verify the connection string format: `postgresql://user:password@host:5432/dbname`
2. Ensure PostgreSQL is running: `pg_isready`
3. Check firewall/network access to the database server
4. Verify credentials are correct

### MySQL authentication failed

**Symptom:** `db_queryMySQL` returns authentication error.

**Solutions:**
1. Verify host, port, user, password, and database parameters
2. Check MySQL user has access from the connecting host
3. Try connecting with the MySQL CLI to verify credentials:
   ```bash
   mysql -h hostname -u user -p database
   ```

### MSSQL connection timeout

**Symptom:** `db_queryMSSQL` times out.

**Solutions:**
1. Set `trustServerCertificate: true` if using self-signed certificates
2. Verify the server is accessible on the specified port (default: 1433)
3. Check if SQL Server allows TCP/IP connections (SQL Server Configuration Manager)
4. Try with `encrypt: false` in development environments

### SQLite "database is locked"

**Symptom:** `db_querySQLite` returns "SQLITE_BUSY" or "database is locked".

**Solution:** Ensure no other process has a write lock on the SQLite file. Close other connections.

---

## CLI Issues

### CLI commands not found

**Symptom:** `hakanmcp` command not recognized.

**Solutions:**
1. Build first: `npm run build`
2. Use npx: `npx hakanmcp`
3. Or link globally: `npm link`
4. Check that `dist/bin/hakanmcp.js` exists

### CLI shows garbled output

**Symptom:** Terminal shows escape codes instead of colors.

**Solutions:**
1. Use a modern terminal (Windows Terminal, iTerm2, etc.)
2. Set `HAKANMCP_QUIET=1` to disable animations:
   ```bash
   HAKANMCP_QUIET=1 npx hakanmcp doctor
   ```
3. Set `HAKANMCP_SIMPLE=1` for simplified output

---

## Backup Issues

### Backup fails with permission error

**Symptom:** `backup_create` fails with EPERM or EACCES.

**Solutions:**
1. Ensure the backup directory exists and is writable:
   ```bash
   mkdir -p backups
   ```
2. On Windows, run as administrator if writing to restricted paths
3. Check `config.yaml` backup path: `backup.localPath: ./backups`

### Backups consuming too much disk

**Solution:** Adjust retention in `config.yaml`:
```yaml
backup:
  retentionHours: 48    # Reduce from default 72
  intervalHours: 12     # Increase from default 6
```

Or manually clean old backups:
```bash
npx hakanmcp backup run  # then manually delete old files from ./backups/
```

---

## Permission Errors on Windows

### EPERM / EACCES errors

**Solutions:**
1. Run terminal as Administrator for system-level operations
2. Check if files are locked by another process (VS Code, antivirus)
3. For `sysopt_*` tools, administrator privileges are required
4. Disable Windows Controlled Folder Access if it's blocking file writes:
   - Windows Security -> Virus & threat protection -> Ransomware protection

### "taskkill" or "tasklist" not found

**Solution:** These are Windows system commands. Ensure you're running on Windows (not WSL) or use the equivalent Linux commands in WSL.

---

## Monitoring / Guardian Issues

### Guardian loop warnings

**Symptom:** Repeated `[WARN] Guardian check failed` messages.

**Solutions:**
1. If not using peer instances, disable the Guardian:
   - Set `monitoring.enabled: false` in `config.yaml`, or
   - Set `GUARDIAN_LOOP_ENABLED=0` environment variable
2. If using peer instances, verify the peer path exists:
   ```yaml
   monitoring:
     peerInstance: ./peer  # This directory must exist
   ```

---

## General Tips

1. **Run the doctor:** `npx hakanmcp doctor` checks most common issues
2. **Check logs:** Look in `logs/` directory for detailed error information
3. **Smoke tests:** `npm run test:smoke` verifies core functionality
4. **Full health check via MCP:** Use the `monitor_healthCheck` tool
5. **Reset state:** Delete `scheduler-state.json` and `conversations/` to reset stateful services
6. **Clear cache:** Use the `cache_clear` tool to reset in-memory cache
