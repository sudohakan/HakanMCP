# SysInt Stack Research: Cross-Platform System Intelligence CLI Tools (2025)

**Project**: 245 NirSoft CLI equivalents in TypeScript/Node.js
**Platforms**: Windows, WSL, Linux
**Status**: Research complete — ready for implementation planning

---

## Recommended Stack

### Core Runtime
- **Node.js 20.x LTS** (HakanMCP already requires >=20.0.0)
  - ES modules (already enabled in project)
  - Built-in crypto, os, fs, child_process, path modules sufficient for 70% of tools
  - Performance: fast enough for CLI tools (no persistent monitoring needed)

### TypeScript Setup
- **TypeScript 5.9+** (current in package.json)
- **Zod 4.1+** for schema validation (already in dependencies)
- Strict mode, ESM target: `{"module": "ES2022", "target": "ES2020"}`

### Package Architecture
- **Monorepo structure**: `src/tools/sysint/` directory with category subdirectories
- **Lazy-loading**: tools loaded on-demand via MCP dispatcher (existing pattern in nirsoft.ts)
- **Single output adapter**: JSON default with CSV/raw as fallback

---

## Key Libraries

### 1. System Information (Cross-Platform Base)

| Package | Version | Purpose | Platform Coverage | Notes |
|---------|---------|---------|-------------------|-------|
| **systeminformation** | 5.31.5+ | CPU, memory, network, disk, processes, USB, audio, displays | Win/Linux/macOS | Proven battle-tested; covers 50+ NirSoft tools (CPU load, mem, network, process list) |
| **os** (Node.js built-in) | ≥20.0 | CPUs, memory, hostname, platform, uptime | Cross-platform | Always use for basic queries; faster than external libs |

**Integration**: systeminformation as fallback for complex queries. Use `os.*` for simple metrics first.

### 2. Windows-Specific Access

| Package | Version | Purpose | Considerations |
|---------|---------|---------|-----------------|
| **winreg** | 1.2.4+ | Windows registry read-only access | Lightweight; no native deps. Covers registry tools, software list, network adapters. |
| **node-ffi-napi** | 3.0.0+ | Native function calling (DPAPI, Windows API). Optional — high complexity. | Use only for password decryption tools. Requires Windows build tools. |
| **win-registry** | 4.0.0+ | Drop-in for winreg with more methods | Alternative if winreg insufficient |
| **crypto** (Node.js built-in) | ≥20.0 | DPAPI integration on Windows via child_process calls to certutil/dpapi-ng | Avoids native deps; uses system tools |

**Strategy**: 
- Registry reads → winreg
- Password decryption → `child_process.execFile('certutil', ['-decodeBase64'...])` calling Windows tools
- Complex Windows APIs (SMART, WMI) → spawn `powershell.exe` with WMI queries

### 3. SQLite for Browser Data

| Package | Version | Purpose | Note |
|---------|---------|---------|------|
| **better-sqlite3** | 11.0.0+ | Synchronous SQLite3; zero external deps; fastest | Preferred for CLI tools (sync is fine for single-shot queries) |
| **sqlite3** | 5.1.7+ | Async variant (callback-based) | Heavier; skip unless better-sqlite3 fails |
| **sql.js** | 1.8.0+ | Pure JS SQLite (read-only) | Fallback if native binding fails; no write support |

**Integration**: better-sqlite3 for browser history, cookies, auto-login data (Chrome, Firefox, Edge, Safari on Win).

### 4. Linux-Specific Metrics

| Package | Version | Purpose |
|---------|---------|---------|
| **fs** (Node.js built-in) | ≥20.0 | Read /proc, /sys, /etc directly |
| **child_process** (Node.js built-in) | ≥20.0 | Parse lsof, netstat, dmidecode, etc. |

**Strategy**: Parse `/proc/[pid]/stat`, `/proc/cpuinfo`, `/proc/meminfo`, `/proc/net/tcp`, `/sys/block/*/stat` directly. Use spawned CLI commands only as fallback.

### 5. Child Process Management

| Function | Use Case |
|----------|----------|
| `execFile()` | Single command with args (preferred; no shell overhead) |
| `exec()` | Shell commands with pipes/redirects (fallback) |
| `spawn()` | Large output or streaming (avoid for CLI tools) |
| `execFileSync()` | CLI tools requiring synchronous results (acceptable; single-shot) |

**Pattern**: `execFileAsync` for all external commands; timeout 10s default.

### 6. Encryption & DPAPI

| Task | Approach |
|------|----------|
| DPAPI decrypt (Windows) | `child_process.execFile('powershell', ['-Command', 'ConvertFrom-SecureString...'])` |
| DPAPI encrypt | Use Windows credential storage directly (CryptProtectData via child process) |
| SHA256 hashing | `crypto.createHash('sha256')` |
| Base64 | Node.js built-in Buffer (`.toString('base64')`) |

**Avoid**: node-ffi-napi unless absolutely necessary (DPAPI via PowerShell is cleaner).

---

## Platform Adapters

### Architecture Pattern

```typescript
// src/tools/sysint/adapters/platform.ts
export interface PlatformAdapter {
  supports(): boolean;  // true if this tool runs on current platform
  execute(...args): Promise<Record<string, unknown>>;
}

// src/tools/sysint/tools/network/getconnections.ts
import { WindowsGetConnections } from './adapters/windows.ts';
import { LinuxGetConnections } from './adapters/linux.ts';

export async function getconnections(args) {
  const adapter = process.platform === 'win32' 
    ? new WindowsGetConnections() 
    : new LinuxGetConnections();
  
  if (!adapter.supports()) {
    throw new Error(`Tool not available on ${process.platform}`);
  }
  return adapter.execute(...args);
}
```

### Windows Paths
- Use `C:\Users\{user}\AppData\Local\` for Chrome/Edge data
- Use `C:\Users\{user}\AppData\Roaming\` for Firefox, Thunderbird
- Handle both NTFS (local paths) and WSL mount points (`/mnt/c/Users/...`)

### Linux Paths
- Home: `process.env.HOME` or `/home/{user}/`
- Chrome: `~/.config/google-chrome/Default/`
- Firefox: `~/.mozilla/firefox/`
- System calls: `/proc/`, `/sys/`, `/etc/`

### WSL Detection
Reuse existing: `src/services/nirsoft/platform.ts` — `isWSL()` function already correct.

---

## Testing Strategy

### Unit Tests (Jest configured)

#### Test Windows code on Linux (without mocking)
- Use test fixtures: copy real browser databases to tmp during test setup
- Use test Windows paths via environment variable overrides
- Load real registry snapshots as JSON

#### Platform-specific skipping
```typescript
describe('Windows Registry Tools', () => {
  beforeAll(() => {
    if (process.platform !== 'win32' && !isWSL()) {
      return; // Skip on pure Linux
    }
  });

  it('reads HKEY_LOCAL_MACHINE', async () => {
    const registry = new WinRegistry({ hive: 'HKLM' });
    const result = await registry.list();
    expect(result.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests
- Mock `child_process.execFile` to return fixture data
- Test JSON output schema (Zod validation)
- Test CSV formatting (if applicable)

### Platform Testing Matrix
| Tool | Windows | WSL | Linux | macOS |
|------|---------|-----|-------|-------|
| CPU/Memory (os module) | ✓ | ✓ | ✓ | Partial |
| Process list (systeminformation) | ✓ | ✓ | ✓ | ✓ |
| Network connections (PowerShell/netstat) | ✓ | ✓ | ✓ | Partial |
| Registry (winreg) | ✓ | ✓ | ✗ | ✗ |
| Browser data (SQLite) | ✓ | ✓ | ✓ | ✓ |
| /proc parsing | ✗ | ✓ | ✓ | ✗ |

**Test command**: `npm run test:sysint -- --coverage`

---

## Category Implementation Guide

### Phase 1: System (easiest, highest impact)
- **cpuload, memory, uptime, processes**: `os.*` + systeminformation
- **Dependency**: None (just Node.js built-ins)
- **Estimated tools**: 15 CLI equivalents
- **Time**: 1-2 days

### Phase 2: Network
- **ipconfig, netstat, wifinetworks, arp**: PowerShell on Windows, Linux `/proc/net/*` + netstat/ss
- **Dependency**: systeminformation (cross-platform API)
- **Estimated tools**: 20 CLI equivalents
- **Time**: 2-3 days

### Phase 3: Browser
- **browsercookiesview, browserdownloadsview, chromepass**: better-sqlite3 + DPAPI
- **Dependency**: better-sqlite3, Windows CryptoAPI via child_process
- **Estimated tools**: 15 CLI equivalents
- **Time**: 3-4 days (password decryption tricky)

### Phase 4: Disk & Files
- **drivelettersview, disksmartview, filesyscleanerview**: PowerShell WMI + Linux sysfs
- **Dependency**: systeminformation (some disk queries)
- **Estimated tools**: 15 CLI equivalents
- **Time**: 2-3 days

### Phase 5: Registry (Windows-only)
- **registrychangesview, userchangesview, inifilestringschanger**: winreg
- **Dependency**: winreg
- **Estimated tools**: 10 CLI equivalents
- **Time**: 2 days

### Phase 6: Process & DLL
- **process explorer, dllexportviewer, loadeddllsview**: `os.arch()` + PowerShell `Get-Process`
- **Dependency**: systeminformation
- **Estimated tools**: 15 CLI equivalents
- **Time**: 2-3 days

### Phase 7: Outlook & Email
- **outlookattachmentssview, outlookemailaddressesview**: COM object access via PowerShell
- **Dependency**: PowerShell scripting
- **Estimated tools**: 8 CLI equivalents
- **Time**: 3-4 days (COM objects fragile)

### Phase 8: Audio & Multimedia
- **soundvolume, volumemeteraccordance**: Windows audio APIs (difficult) or skip/stub
- **Dependency**: Native bindings (avoid if possible)
- **Estimated tools**: 5 CLI equivalents
- **Time**: 2 days (stub most)

### Phase 9: Programmer Tools
- **regscoperegexpsearch, filesize, searchmyfiles, executablefilesviewer**: CLI wrappers
- **Dependency**: Minimal (fs, grep)
- **Estimated tools**: 15 CLI equivalents
- **Time**: 2-3 days

### Phase 10: Password Tools (free version limitations)
- **Most password tools**: CLI export disabled in free version
- **Strategy**: Stub with "requires purchase" messages + offer data extraction from installed paid versions
- **Estimated tools**: 19 stubs + 5 extractors
- **Time**: 1 day (stubs) + ongoing (extractors)

---

## Performance Considerations

### Lazy-Loading for 250+ Tools
- Tools loaded on-demand (reuse HakanMCP's nirsoft.ts dispatcher pattern)
- Catalog in JSON: < 100 KB
- Tool module size target: < 50 KB per tool (TypeScript + compiled)
- MCP server startup: < 500ms (catalog only)
- Tool execution: < 2s for most queries (timeout 10s)

### Memory Usage
- Single tool instance: ~5-10 MB base
- systeminformation: ~2 MB per call
- better-sqlite3: ~1-2 MB per query
- Total expected: < 50 MB for HakanMCP with all tools loaded

### Optimization Rules
1. Prefer built-in `os.*` and `fs.*` over npm packages
2. Cache catalog in memory (already done)
3. Reuse database connections (SQLite connection pooling not critical for CLI tools)
4. Avoid loading systeminformation unless needed; use direct /proc parsing
5. Use `execFileSync()` only for small output; switch to async for large results

---

## What NOT to Use (And Why)

| Package | Why Not | Alternative |
|---------|---------|-------------|
| **pma11y-cli** | Unmaintained; bloated | Use native APIs |
| **diskusage** | Complex native binding | Use `du` command or /proc |
| **node-hid** | Requires USB access; Windows-only | Skip USB device enumeration or use WMI |
| **node-gyp** | Adds build complexity for optional features | Avoid native modules; use child_process instead |
| **systeminformation (async mode)** | Slower than sync for CLI tools | Use promise-based API; consider sync alternatives |
| **ioctl** | Low-level; not portable | Use sysctl (Linux) or WMI (Windows) |
| **pmctl** | Not a real package; skip | Use direct system calls |

---

## Example: Implementing a Single Tool (network/getconnections)

```typescript
// src/tools/sysint/network/getconnections.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ToolResponse } from '../../../types/index.js';

const execFileAsync = promisify(execFile);

const GetConnectionsArgsSchema = z.object({
  filter: z.enum(['all', 'tcp', 'udp']).optional().default('all'),
  resolveHostnames: z.boolean().optional().default(false),
});

interface Connection {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  processId?: number;
  processName?: string;
}

export async function getconnections(args: unknown): Promise<ToolResponse> {
  const parsed = GetConnectionsArgsSchema.parse(args);

  try {
    const connections = process.platform === 'win32'
      ? await getConnectionsWindows(parsed)
      : await getConnectionsLinux(parsed);

    return {
      success: true,
      data: {
        total: connections.length,
        connections,
      },
      meta: {
        platform: process.platform,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      meta: { platform: process.platform },
    };
  }
}

async function getConnectionsWindows(opts: {
  filter: string;
  resolveHostnames: boolean;
}): Promise<Connection[]> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-NetTCPConnection -State Established | Select-Object -Property LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | ConvertTo-Json -AsArray`,
  ]);

  const data = JSON.parse(stdout) as Array<{
    LocalAddress: string;
    LocalPort: number;
    RemoteAddress: string;
    RemotePort: number;
    State: string;
    OwningProcess: number;
  }>;

  return data.map((row) => ({
    localAddress: row.LocalAddress,
    localPort: row.LocalPort,
    remoteAddress: row.RemoteAddress,
    remotePort: row.RemotePort,
    state: row.State,
    processId: row.OwningProcess,
  }));
}

async function getConnectionsLinux(opts: {
  filter: string;
  resolveHostnames: boolean;
}): Promise<Connection[]> {
  const { stdout } = await execFileAsync('ss', [
    '-tanp',
    '--json',
  ]);

  const data = JSON.parse(stdout) as { TCP: Array<Record<string, unknown>> };
  return data.TCP.map((row) => ({
    localAddress: (row.local_address as string) || '',
    localPort: parseInt(row.local_port as string) || 0,
    remoteAddress: (row.peer_address as string) || '',
    remotePort: parseInt(row.peer_port as string) || 0,
    state: (row.state as string) || 'UNKNOWN',
  }));
}
```

---

## Confidence Levels

| Area | Confidence | Rationale |
|------|-----------|-----------|
| Core system metrics (CPU, mem, processes) | 95% | Built-ins + systeminformation proven; already in HakanMCP |
| Network tools | 85% | PowerShell + netstat reliable; ss on Linux mature |
| Browser data extraction | 75% | SQLite format stable; DPAPI integration doable but tricky |
| Windows registry | 90% | winreg is stable and lightweight |
| Disk/SMART queries | 70% | WMI on Windows fragile; sysfs on Linux good |
| Outlook/COM objects | 50% | COM integration via PowerShell unpredictable |
| Audio tools | 40% | Windows audio APIs complex; may require stubbing |
| Password tools | 30% | Free version limitations; paid tool integration complex |

---

## Next Steps (For Implementation Planning)

1. Create tool template in `src/tools/sysint/` matching phase structure
2. Implement Phase 1 (System) as proof-of-concept
3. Establish platform adapter pattern and test utilities
4. Build catalog.json v2 with SysInt entries
5. Wire into MCP dispatcher (extend nirsoft.ts or create sysint.ts)
6. Prioritize high-confidence categories first (Network, Process, Disk)
7. Stub or skip low-confidence categories (Audio, Password) initially

---

*Research completed: 2026-04-07*
*Next: `/gsd:plan-phase` for Phase 1 implementation roadmap*
