# Cross-Platform System Intelligence Tools: Critical Pitfalls

## Platform-Specific Gotchas

### 1. Path Handling Inconsistencies

**Warning Signs**
- Code that assumes forward slashes work everywhere
- Hardcoded path separators (e.g., `/` or `\`)
- Tests pass on one platform but fail on another
- Symlink resolution differs between Windows and Linux
- UNC paths on Windows not normalized (`\\?\C:\path`)

**Prevention Strategy**
- Use `path.join()`, `path.resolve()`, `path.normalize()` consistently
- Test all path operations on both Windows + WSL + native Linux in CI
- Handle UNC paths for network shares: prefix `\\?\` for long paths
- For WSL interop: cache WSL detection result (expensive `/proc/version` checks)
- Create path utilities that normalize and validate before use:
  ```typescript
  // Bad: hardcoded separators
  const p = `C:\\Users\\${name}\\data`;
  
  // Good: use path module
  const p = path.join('C:', 'Users', name, 'data');
  ```

**Which Phase Should Address It**
- Research phase: document platform-specific path rules
- Spec phase: define path abstraction interface
- Development: implement per-platform path builders
- Testing: validate all paths on both Windows and non-Windows in CI (mandatory)

---

### 2. Environment Variable Encoding Issues

**Warning Signs**
- Garbage characters in tool output when reading environment
- Tools fail when PATH contains non-ASCII characters
- Different behavior in PowerShell vs cmd.exe vs Bash
- Temporary file paths with special characters cause command injection

**Prevention Strategy**
- Always specify encoding when reading environment: `process.env` is safe, but file-based env needs UTF-8
- Quote all paths in PowerShell commands (escape single quotes as `''`)
- Use `execFile()` with argument array instead of `exec()` with string concatenation
- Test with paths containing spaces, emoji, Chinese characters
- Windows environment variables are case-insensitive — normalize keys when comparing
  ```typescript
  // Bad: string interpolation, encoding risk
  const cmd = `powershell.exe -Command "${exePath} ${args}"`;
  
  // Good: execFile with array
  await execFileAsync('powershell.exe', ['-Command', `& "${exePath}" ...`]);
  ```

**Which Phase Should Address It**
- Research: determine which env vars tools depend on
- Spec: define safe env var passing interface
- Development: use execFile + array args everywhere, never string concat
- Testing: test with non-ASCII paths and env vars (CI matrix)

---

### 3. File Permissions and Access Control

**Warning Signs**
- Code assumes files are readable without checking permission errors
- "Works on my machine but fails in CI"
- Tests pass with admin/root but fail for regular users
- Network drives fail silently instead of reporting error
- NTFS ACLs not considered (Windows ACLs can block even for "owner")

**Prevention Strategy**
- Always wrap file operations in try/catch, don't swallow errors silently
- Probe file accessibility before attempting read: check both existence and readability
- Windows: Use PowerShell `Get-Acl` or `Test-Path -PathType Leaf` to verify before read
- Linux: Check `fs.accessSync(path, fs.constants.R_OK)` before reading
- Respect UAC boundaries — don't assume elevated access without explicit check
- On Windows, some registry hives are only readable with admin
- Document which tools require elevated privileges upfront
  ```typescript
  // Bad: blindly read, silently fail
  try {
    const data = fs.readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  
  // Good: explicit permission check, clear error
  if (!fs.accessSync(path, fs.constants.R_OK)) {
    throw new Error(`No read permission: ${path}`);
  }
  ```

**Which Phase Should Address It**
- Research: map which tools require admin/root (already done in catalog)
- Spec: define privilege escalation flow (admin user check, UAC prompt handling)
- Development: implement permission checks before operations
- Testing: run tests both as regular user and admin/root (CI matrix)

---

### 4. Line Ending Normalization (CRLF vs LF)

**Warning Signs**
- CSV parsing fails intermittently
- String comparisons fail ("line" !== "line\r")
- `split('\n')` leaves `\r` at end of each line on Windows
- Git history gets corrupted (all files marked as changed)

**Prevention Strategy**
- Normalize line endings immediately after reading: `content.replace(/\r\n/g, '\n')`
- When parsing CSV from NirSoft tools (Windows-native), always expect CRLF
- Set `.gitattributes` to enforce LF: `*.sh text eol=lf`
- Use `csv-parse` library with correct line ending handling
- Don't rely on platform default — explicitly normalize

**Which Phase Should Address It**
- Development: normalize all file reads immediately
- Testing: verify CSV parsing with both CRLF and LF inputs
- Git: add `.gitattributes` rules for text files

---

## Browser Data Access Pitfalls

### 5. Locked SQLite Databases

**Warning Signs**
- "Database is locked" errors on Windows when browser is running
- Browser caches are inaccessible without copying first
- Inconsistent results depending on browser state (running vs closed)
- Backups fail because Chrome maintains read-lock on profile folder

**Prevention Strategy**
- Check if browser process is running before attempting access
- Copy database to temp file first, then read: never read in-place
- Use WAL (write-ahead logging) mode detection — Chrome uses WAL, need to copy `-wal` and `-shm` files too
- Implement retry logic with backoff for locked databases (100ms retry, 3 attempts)
- On Windows: use `lsof` via PowerShell's equivalent or check process handles
- Detect browser: `Get-Process chrome, firefox, msedge | Where-Object {$_.Name}`
  ```typescript
  // Bad: direct read, will fail if browser open
  const data = sqlite3.Database(path);
  
  // Good: copy to temp first, then read
  const tempDb = path.join(os.tmpdir(), 'profile-' + Date.now() + '.db');
  fs.copyFileSync(srcDb, tempDb);
  const data = sqlite3.Database(tempDb);
  ```

**Which Phase Should Address It**
- Research: document browser schema for Chrome, Firefox, Edge (changes frequently)
- Spec: define database access interface (copy-first pattern)
- Development: implement safe database accessor with retry
- Testing: run with browser open and closed (mandatory for browser tools)

---

### 6. Browser Schema Version Drift

**Warning Signs**
- Tools work with Chrome 120 but break with Chrome 125
- Column names changed or table structure reorganized
- Decryption fails (v91+ uses different encryption scheme)
- Bookmark structure has nested JSON instead of flat tables

**Prevention Strategy**
- Version-detect browser at tool load time: check Chrome version from registry or version.txt
- Maintain schema adapters per major version: `schema/chrome-120.ts`, `schema/chrome-125.ts`
- Document schema changes in a compatibility matrix
- Use version-specific queries: `SELECT * FROM [passwords] WHERE version >= 2`
- For password tables: detect encryption method (v90 = encrypted, v91+ = Argon2)
- Cache schema detection per tool invocation, not globally (avoid stale version info)
  ```typescript
  // Bad: assume single schema
  const passwords = db.query('SELECT username, password FROM logins');
  
  // Good: version-detect, use appropriate schema
  const version = getChromeVersion();
  const schema = getSchemaForVersion(version);
  const passwords = db.query(schema.getPasswordQuery());
  ```

**Which Phase Should Address It**
- Research: capture schema for Chrome, Firefox, Edge (current + 2 previous versions)
- Spec: define schema adapter interface, versioning strategy
- Development: implement per-browser, per-version handlers
- Testing: test with multiple browser versions (Docker containers or snapshots)

---

### 7. Encryption/Decryption Complexity

**Warning Signs**
- Passwords decode to garbled text
- "Invalid key" or "HMAC mismatch" errors
- Different results on Windows vs Linux (DPAPI-encrypted vs plaintext)
- Credentials are sometimes encrypted, sometimes not (inconsistent state)

**Prevention Strategy**
- For Chrome: use `pycryptodome` or equivalent (Node lacks native DPAPI)
  - Windows: DPAPI encryption with Windows Data Protection API
  - Linux/macOS: uses plaintext or Keyring; detect platform
- For Firefox: Master Password must be known or tool must skip encrypted items
- For Windows: credentials in Credential Manager use DPAPI — need to shell to PowerShell
  ```powershell
  Get-StoredCredential -Target "target_name" | Select-Object -ExpandProperty Password
  ```
- Graceful degradation: if decryption fails, return encrypted blob or skip item
- Don't attempt homegrown crypto — use battle-tested libraries

**Which Phase Should Address It**
- Research: map encryption scheme per browser/OS combination
- Spec: define decryption strategy (shell to native APIs vs libraries)
- Development: implement platform-specific handlers, add fallback
- Testing: test with both plaintext and encrypted credential states

---

## Privilege Escalation Issues

### 8. Admin/Root Detection and Escalation

**Warning Signs**
- Tools silently fail when run as unprivileged user
- Registry access works in admin shell but not in normal shell
- Event logs are empty instead of showing "Access Denied"
- Windows command `whoami /groups` includes S-1-16-12288 (high integrity) only for admin

**Prevention Strategy**
- Check privilege level at tool startup, before execution:
  ```typescript
  // Windows: powershell
  const { stdout } = await exec('powershell -Command "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"');
  const isAdmin = stdout.trim() === 'True';
  
  // Linux
  const isRoot = process.getuid?.() === 0;
  ```
- For Windows tools requiring admin: spawn new process with `Start-Process -Verb RunAs -Wait`
- For Linux tools requiring root: check CAP_* capabilities via `/proc/self/status`
- Document per tool: "admin required" flag (already in NirSoft catalog)
- Warn user early rather than failing mid-operation
- UAC prompt on Windows — handle via PowerShell `-Verb RunAs` (shows UAC dialog)

**Which Phase Should Address It**
- Research: catalog which tools require elevated privileges
- Spec: define escalation flow (check, prompt, fail gracefully)
- Development: implement privilege checks, escalation handlers
- Testing: test as both regular user and admin/root (CI matrix)

---

### 9. Privilege Elevation Reliability

**Warning Signs**
- UAC dialog hangs or never appears
- `Start-Process -Verb RunAs` returns 0 but process didn't actually run
- Child process exits before output is flushed
- Elevated process can't write to temp directory owned by non-elevated user

**Prevention Strategy**
- Use `-Wait` flag on `Start-Process` (always)
- Redirect output to file, not stdout (elevated process runs in different context)
- Create temp directory with proper ownership before escalation
- Capture exit code, not just stderr (non-zero exit = failure)
- For long operations: write to log file, then read log after process exits
- Don't pass sensitive data via command line (visible in process explorer) — use temp file instead

**Which Phase Should Address It**
- Development: implement robust elevation with file-based communication
- Testing: test elevation scenarios (will need manual UAC interaction or automation)

---

## Performance Traps

### 10. Child Process Spawn Overhead

**Warning Signs**
- Tool takes 5+ seconds for simple query
- WSL interop overhead (cmd.exe call from WSL takes 100-500ms)
- Creating PowerShell process per tool call adds latency
- Parallel tool execution blocks on process limits

**Prevention Strategy**
- Batch multiple tool calls into single process: cache process handles if safe
- Prefer direct Node.js APIs over spawning (e.g., read `/proc/cpuinfo` directly instead of calling `uname`)
- For WSL: precompile regex for path conversion, cache WSL detection (very expensive check)
- Use `execFile()` (fast) instead of `exec()` (spawns shell)
- On Windows: cache PowerShell session if running multiple commands
- Measure per-tool execution time — log slowness to guide optimization
- Set reasonable timeouts: default 30s, shorter for simple queries (5s), longer for scans (120s)

**Which Phase Should Address It**
- Development: profile each tool, identify bottlenecks
- Testing: measure latency, set performance budgets (e.g., <2s for simple queries)
- Optimization: batch calls, cache results appropriately

---

### 11. Large File and /proc Parsing

**Warning Signs**
- Memory usage spikes when reading system logs
- `/proc/*/status` parsing is O(n²) because of repeated regex matches
- Streaming large CSV doesn't work (loads entire file in memory)
- Process list parsing is slow with many processes (>1000)

**Prevention Strategy**
- Stream files instead of loading entire content: `fs.createReadStream()`
- For `/proc` files: parse line-by-line, not by slurping entire file
- Precompile regex for repeated parsing: `const regex = /pattern/; for (const line of lines) { regex.test(line); }`
- Use `csv-parse` with streaming for large CSVs
- Set file size limits: warn if log >100MB, skip if >1GB
- Batch stat operations: `Promise.all([fs.promises.stat(...), ...])` is faster than sequential
  ```typescript
  // Bad: load entire file, then parse
  const content = fs.readFileSync(path, 'utf8');
  const lines = content.split('\n').map(parseLine);
  
  // Good: stream, parse line-by-line
  const rl = readline.createInterface({ input: fs.createReadStream(path) });
  for await (const line of rl) {
    processParsedLine(parseLine(line));
  }
  ```

**Which Phase Should Address It**
- Development: use streaming APIs from start
- Testing: test with large files (1GB+), measure memory usage
- Optimization: profile hot paths, add file size checks

---

### 12. Timeout Handling Inconsistencies

**Warning Signs**
- Tool hangs indefinitely on network error
- Timeout in child process doesn't propagate to parent
- Mixed units (milliseconds vs seconds) in different timeout calls
- Default timeout too short for large scans

**Prevention Strategy**
- Standardize on milliseconds everywhere: convert seconds to ms at boundaries only
- Always set timeout on `exec`/`execFile`: `{ timeout: 30000 }` (ms)
- For network tools: set socket timeout separately (not just process timeout)
- Handle timeout errors explicitly: catch, then kill child process
- Timeout value depends on tool type:
  - Simple registry/config read: 5000ms
  - File scan: 30000ms
  - Network operations: 10000-60000ms depending on scope
- Document timeout per tool in catalog (already planned)
  ```typescript
  // Bad: mixed units, no timeout
  exec('tool.exe');
  
  // Good: explicit ms, error handling
  try {
    await execFileAsync('tool.exe', [], { timeout: 30 * 1000 });
  } catch (err) {
    if (err.killed) throw new Error('Tool timeout exceeded');
    throw err;
  }
  ```

**Which Phase Should Address It**
- Spec: define default timeouts per tool category
- Development: implement consistent timeout handling
- Testing: verify timeouts work on slow systems (simulate delays)

---

## Security Concerns

### 13. Credential Handling in System Tools

**Warning Signs**
- Passwords appear in command-line arguments (visible via `ps aux`)
- Decrypted credentials held in memory longer than needed
- No memory clearing after password extraction
- Temp files with credentials left on disk

**Prevention Strategy**
- Never pass credentials via command-line arguments — use temp file + file descriptor
- Use `Buffer.alloc()` for sensitive data, zero it immediately after use: `crypto.randomFillSync(buffer); buffer.fill(0);`
- For file-based credential passing: set restrictive permissions `fs.chmodSync(file, 0o600)`
- Store decrypted data in memory for minimal duration
- Don't log or serialize credentials, even in debug output
- For password tools specifically: mark as "special dependency" (already done)
- Use native APIs where available (PowerShell Get-StoredCredential) instead of reimplementing

**Which Phase Should Address It**
- Research: identify which tools touch sensitive data
- Spec: define credential handling policy
- Development: implement secure buffer handling, audit all credential paths
- Testing: scan code for hardcoded credentials, check for logging leaks

---

### 14. DPAPI and Windows Data Protection

**Warning Signs**
- Attempt to decrypt DPAPI-protected data fails with "Data Protection Error"
- Code works as admin but fails as regular user (DPAPI scope issue)
- Decryption works on Windows but fails when code runs in container/VM
- Machine key vs user key mismatch (moved DPAPI scope)

**Prevention Strategy**
- DPAPI protection scope on Windows:
  - Current user only: `/Data/Application` (most common for browser credentials)
  - Machine-wide: `/Data/Machine` (requires admin)
- Detect scope: attempt user-scoped decrypt first, fall back to machine if user fails
- Don't reimplement DPAPI in Node.js — shell to PowerShell or use WinRT bindings
- For non-Windows: gracefully skip DPAPI-encrypted data (return "encrypted" status)
- Test across user boundaries: decrypt as different user should fail gracefully
  ```powershell
  # Safe DPAPI decryption via PowerShell
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser # or ::AllUsers
  ```

**Which Phase Should Address It**
- Research: document DPAPI usage per browser
- Spec: define DPAPI fallback strategy
- Development: shell to native APIs, never reimplement
- Testing: test decryption as different users

---

## Testing Pitfalls

### 15. Mocking Platform APIs

**Warning Signs**
- Mock tests pass, but tool fails in production
- Platform detection mocks return inconsistent results
- Can't test Windows-specific code on Linux in CI
- Mock child process never reflects real output

**Prevention Strategy**
- Don't mock `fs` or `child_process` — use real files and test commands
- Separate platform-specific code into modules: `platform.ts`, `platform.test.ts`
- For cross-platform testing: use containers (Docker with Windows base image) or matrix CI
- Integration tests must run on actual platform: can't mock Windows ACLs or registry
- Unit tests for pure logic, integration tests for platform interaction
- Use fixture data (real command outputs) for parser tests, not mocked data
- Stub only external services (network calls), not platform APIs

**Which Phase Should Address It**
- Development: separate platform logic, test on real platform only
- Testing: define integration test matrix (Windows, WSL, Linux)
- CI: use GitHub Actions matrix with multiple runners

---

### 16. CI/CD Platform Differences

**Warning Signs**
- Tests pass locally, fail in CI
- Windows CI runner has different tool versions
- Encoding errors in GitHub Actions
- File permissions behave differently on CI runner vs local

**Prevention Strategy**
- CI should match local environment: same Node version, same tool versions
- GitHub Actions Windows runner has different tools pre-installed — document assumptions
- For cross-platform CI:
  - Use matrix: `[ubuntu-latest, windows-latest]`
  - Some tests Windows-only (can skip on Linux with skip decorator)
  - WSL tests: only on Windows runner, but specify WSL environment
- Handle CI-specific quirks:
  - Paths may not have typical structure (use absolute paths)
  - Temp directories may be different
  - Permissions may be different (Windows CI runs as admin by default)
- Test flakiness: timeouts or race conditions that don't appear locally

**Which Phase Should Address It**
- Development: test locally on all supported platforms
- CI: set up matrix runners, document platform-specific skips
- Testing: retry flaky tests, investigate timeout issues

---

## Scope Creep Prevention

### 17. Replicating NirSoft Feature Parity vs Practical Scope

**Warning Signs**
- "We need to support all 245 tools from day one"
- Tool with 50+ output columns but only 3 are useful
- Spending 2 weeks to replicate 1% of NirSoft's features
- Diminishing returns: 80% of value from 20% of tools

**Prevention Strategy**
- Implement MVP per category: 3-5 essential tools that cover 80% of use cases
- For each tool: identify core columns (5-10), defer advanced filtering
- Prioritize by frequency of use in agent workflows:
  - Process list (frequently needed)
  - Port scanner (security/networking)
  - Event logs (troubleshooting)
  - Disk usage (resource management)
- Accept incomplete feature coverage initially — "not implemented" is OK
- Defer advanced options: `--all-columns`, `--filter <expr>`, `--sort <col>`
- Document: "This tool implements core functionality. Filtering via agent post-processing."

**Which Phase Should Address It**
- Research: survey which NirSoft tools are actually useful for AI agents
- Spec: define MVP per category (already started in PROJECT.md)
- Development: implement core functionality, document limitations
- Planning: prioritize by value, not by completeness

---

### 18. Dependencies and Native Module Complexity

**Warning Signs**
- `npm install` fails on Windows (tries to build native modules)
- Prebuilt binaries for different Node versions required
- Some team members can't compile, others can
- Native modules break between Node LTS versions

**Prevention Strategy**
- Avoid native modules if possible: use Node.js built-ins + system calls
- If native modules required:
  - Use prebuilt binaries (avoid compilation)
  - Support multiple Node versions explicitly
  - Test in CI with multiple Node versions
- For Windows-specific APIs: shell to PowerShell instead of `node-ffi`
- For Linux system calls: use `/proc`, `/sys` directly or spawn native tools
- Keep dependencies minimal: every dependency adds attack surface and maintenance burden
- Document required system dependencies:
  - Windows: PowerShell 5.0+, cmd.exe
  - Linux: bash, standard POSIX tools

**Which Phase Should Address It**
- Research: identify which system APIs require native modules
- Spec: prefer Node.js + system tools over native modules
- Development: use prebuilt binaries only, test on multiple Node versions
- Testing: CI matrix with multiple Node versions

---

## Lifecycle and Evolution

### 19. Tool Registration and Discovery

**Warning Signs**
- New tool added but doesn't appear in `nirsoft list`
- Tool registered twice with different IDs
- Catalog JSON doesn't match actual implementations
- Tool ID mismatch: catalog says `id: "proclist"` but code references `tool-id-123`

**Prevention Strategy**
- Single source of truth: `catalog.json` is authoritative
- Registration at tool load time, not at config time
- Validate registration: check tool exists, schema is compatible
- Schema validation: ensure all required fields present (use Zod)
- Tool ID stability: once assigned, never change (backward compatibility)
- Lazy loading: don't load 245 tools at startup
  ```typescript
  // Register each tool at definition time
  const toolDef: ToolDefinition = {
    id: 'proclist',
    name: 'Process List',
    category: 'process',
    // ... schema
  };
  registerTool(toolDef);
  ```

**Which Phase Should Address It**
- Development: implement tool registration pattern
- Testing: validate each tool against schema before loading
- CI: catch registration mismatches in automated tests

---

### 20. Version Compatibility and Breaking Changes

**Warning Signs**
- Tool output schema changes without warning
- Agents break when tool output structure changes
- Can't revert to previous tool version
- No changelog documenting schema changes

**Prevention Strategy**
- Semver tool versions independently: tool version !== MCP version
- Breaking changes require major version bump
- Document schema version in output: `{ schema_version: "1.0", rows: [...] }`
- For schema changes: add new output format, deprecate old (2-release grace period)
- Changelog per tool: `docs/tools/{tool-id}/CHANGELOG.md`
- Communicate changes to agent consumers (or provide schema endpoint)
  ```typescript
  // Always include schema version
  return {
    schema_version: '1.0',
    rows: data,
    count: data.length,
    timestamp: new Date().toISOString(),
  };
  ```

**Which Phase Should Address It**
- Spec: define versioning and compatibility policy
- Development: include schema version in all outputs
- Planning: update changelog for each schema change

---

## Windows-Specific Pitfalls (Beyond Platform-Generic)

### 21. PowerShell vs cmd.exe vs Native Code

**Warning Signs**
- Tool works with cmd.exe but not PowerShell (quoting differences)
- PowerShell 5 code fails in PowerShell 7 (different behavior)
- UAC prompt doesn't appear when expected
- Command pipeline breaks due to encoding

**Prevention Strategy**
- Default to PowerShell 5+ (more powerful): `powershell.exe -NoProfile -NonInteractive`
- Handle both PowerShell and cmd.exe if possible, document which is preferred
- Quote handling differences:
  - cmd.exe: `"path with spaces"`
  - PowerShell: `'path with spaces'` (avoid double quotes in PS args)
- Use `execFile()` with argument array instead of string concatenation
- For complex commands: write to temp `.ps1` file, execute it
- Test on both PowerShell 5 and PowerShell 7 (Core) if using Core-specific features

**Which Phase Should Address It**
- Development: standardize on PowerShell 5+, document assumptions
- Testing: test commands on both PowerShell versions
- CI: verify on Windows runner with specified PowerShell version

---

### 22. Registry Access Patterns

**Warning Signs**
- Registry queries fail intermittently ("Key not found")
- HKCR (HKEY_CLASSES_ROOT) behaves differently in different contexts
- Registry virtualization affects non-admin reads
- 32-bit vs 64-bit registry hives confusion (WOW64)

**Prevention Strategy**
- Use PowerShell `Get-ItemProperty` (handles registry complexity):
  ```powershell
  Get-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion' -Name ProductName
  ```
- Don't shell directly to `reg query` (brittle output parsing)
- Handle HKCR redirection: HKCR is virtual, maps to HKLM + HKCU
- For 32-bit vs 64-bit: PowerShell handles automatically on x64
- Expect "Key not found" as normal case: wrap in try/catch
- Don't assume registry values exist (they might be deleted or not present)

**Which Phase Should Address It**
- Development: use PowerShell Get-ItemProperty, avoid direct reg.exe
- Testing: test with missing registry keys (common case)

---

## Linux-Specific Pitfalls

### 23. /proc and /sys Filesystem Parsing

**Warning Signs**
- Memory usage from `/proc/meminfo` doesn't match `free` command
- Process CPU time doesn't parse correctly (units change between kernels)
- Cgroup limits differ from actual available memory
- `/proc/<pid>/fd` symlinks unreadable due to permissions

**Prevention Strategy**
- Parse `/proc/meminfo` line-by-line, not assuming fixed format:
  - MemTotal, MemAvailable, MemFree, Cached, Buffers vary by kernel version
- For CPU: use `/proc/stat` which is stable, not `/proc/uptime`
- Check cgroups first (v2 at `/sys/fs/cgroup`, v1 at `/sys/fs/cgroup/*/`), fall back to /proc
- Process FDs in `/proc/<pid>/fd` may be unreadable — skip unreadable with permission check
- Document kernel version assumptions (most tools assume Linux 4.4+)

**Which Phase Should Address It**
- Research: document /proc format variations across kernel versions
- Development: parse flexibly, handle missing fields
- Testing: test on multiple Linux kernel versions if possible

---

### 24. Capability-Based Security (CAP_* on Linux)

**Warning Signs**
- Tool works as root but fails as regular user with CAP_SYS_ADMIN
- Network tools fail: need CAP_NET_RAW for raw sockets
- "Operation not permitted" in containers (capabilities dropped)

**Prevention Strategy**
- Check relevant capabilities in `/proc/self/status`:
  - CAP_SYS_ADMIN: system-level operations
  - CAP_NET_RAW: network sniffing
  - CAP_DAC_READ_SEARCH: bypass file permission checks
- Document per tool which capability is needed
- Graceful degradation: if missing CAP_*, return empty result with explanation
- Containers often drop most capabilities: design tools to work with minimal CAP_*

**Which Phase Should Address It**
- Research: catalog required capabilities per tool
- Development: check capabilities, fail gracefully
- Testing: test both with and without capabilities

---

### 25. Network Tool Limitations (Raw Sockets on Linux)

**Warning Signs**
- Port scanner fails: "Operation not permitted" (needs CAP_NET_RAW)
- Packet sniffer requires root: can't run as regular user
- Network sniffing works with npcap on Windows, fails on Linux

**Prevention Strategy**
- Port scanner: use `netstat`, `ss`, or `/proc/net/tcp` parsing instead of raw sockets
- Sniffer: require root/CAP_NET_RAW or document limitation
- For WSL: Windows native tools are usually better for network operations
- On Linux: use `ethtool`, `ip`, `netstat` commands instead of raw socket APIs
- Document: "This tool requires `CAP_NET_RAW` capability or root privilege"

**Which Phase Should Address It**
- Research: identify which tools need raw sockets
- Spec: define alternative approaches for each platform
- Development: implement per-platform approach
- Testing: verify on systems with and without privileges

---

## Summary

| Priority | Pitfall | Root Cause | Fix Timing |
|----------|---------|-----------|-----------|
| CRITICAL | Browser DB locks | Concurrent access | Design phase (spec) |
| CRITICAL | Admin detection race | Privilege check timing | Development + Testing |
| CRITICAL | Path normalization | Platform differences | Research + Development |
| CRITICAL | Credential exposure | Passing via args/logs | Development + Review |
| HIGH | CSV parsing (CRLF) | Windows text format | Development |
| HIGH | Timeout inconsistency | Mixed units | Spec + Development |
| HIGH | Process spawn overhead | WSL interop | Development + Optimization |
| MEDIUM | Schema drift | Version updates | Research (ongoing) |
| MEDIUM | Child process output | Encoding issues | Development + Testing |
| MEDIUM | Scope creep | Feature parity trap | Planning phase |

---

## Next Steps for SysInt Project

1. **Research Phase** (ongoing):
   - Document browser schema changes across versions
   - Catalog Linux capabilities needed per tool category
   - Benchmark child process overhead (WSL vs native)

2. **Spec Phase** (before development):
   - Define privilege escalation flow (UAC, sudo)
   - Define credential handling policy
   - Define timeout per tool category
   - Define schema versioning and compatibility

3. **Development Phase**:
   - Implement platform abstraction layer (paths, procs, registry)
   - Implement permission checks and graceful degradation
   - Normalize all line endings and encodings
   - Profile latency per tool

4. **Testing Phase**:
   - CI matrix: [Ubuntu, Windows] × [Node 18, 20, 22] × [admin/regular user]
   - Integration tests with browser open and closed
   - Large file tests (>1GB logs)
   - Security: scan for credential leaks, DPAPI issues

5. **Evolution**:
   - Implement schema versioning in all tool outputs
   - Document breaking changes in per-tool changelog
   - Monitor agent feedback on tool usability
   - Defer non-core features initially

---

*Last updated: 2026-04-07*
