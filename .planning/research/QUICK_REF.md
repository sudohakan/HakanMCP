# SysInt Stack Quick Reference

## 1-Minute Summary

**Goal**: 245 CLI tools replacing NirSoft (Windows system intelligence)  
**Stack**: Node.js 20+ + TypeScript 5.9 + systeminformation + better-sqlite3  
**Platforms**: Windows, WSL, Linux  
**Approach**: Platform adapters + lazy-loading + JSON output

## Essential Packages

```json
{
  "dependencies": {
    "systeminformation": "^5.31.5",
    "better-sqlite3": "^11.0.0",
    "winreg": "^1.2.4",
    "zod": "^4.1.13"
  }
}
```

**Already in HakanMCP**: typescript, zod, commander, fs, os, child_process, crypto

## Code Template

```typescript
// src/tools/sysint/category/toolname.ts

import { z } from 'zod';
import type { ToolResponse } from '../../../types/index.js';

const InputSchema = z.object({
  // args here
});

export async function toolname(args: unknown): Promise<ToolResponse> {
  const parsed = InputSchema.parse(args);
  
  try {
    const result = process.platform === 'win32'
      ? await runWindows(parsed)
      : await runLinux(parsed);
    
    return { success: true, data: result, meta: { platform: process.platform } };
  } catch (error) {
    return { success: false, error: error.message, meta: { platform: process.platform } };
  }
}

async function runWindows(opts: any) {
  // Use PowerShell, WMI, registry, DPAPI
}

async function runLinux(opts: any) {
  // Use /proc parsing, netstat, sysfs
}
```

## Platform-Specific Patterns

### Windows Registry
```typescript
import WinRegistry from 'winreg';

const key = new WinRegistry({ hive: 'HKLM', key: '\\Software\\Microsoft\\Windows\\CurrentVersion' });
const items = await key.values();
```

### Browser SQLite (Chrome/Firefox)
```typescript
import Database from 'better-sqlite3';

const db = new Database(`${HOME}/.config/google-chrome/Default/History`);
const downloads = db.prepare('SELECT * FROM downloads').all();
db.close();
```

### PowerShell on Windows
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync('powershell.exe', [
  '-NoProfile',
  '-Command',
  'Get-Process | ConvertTo-Json -AsArray'
]);
const processes = JSON.parse(stdout);
```

### Linux /proc parsing
```typescript
import fs from 'node:fs';

const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
```

## Testing Platform Code on Non-Target Platform

```typescript
describe('Windows tools (runnable on Linux via mocks)', () => {
  beforeEach(() => {
    // Mock execFile to return fixture data
    jest.mock('node:child_process', () => ({
      execFile: jest.fn((cmd, args, callback) => {
        if (cmd.includes('powershell')) {
          callback(null, { stdout: JSON.stringify(FIXTURE_WINDOWS_PROCESSES) });
        }
      })
    }));
  });

  it('parses process list', async () => {
    const result = await getProcesses();
    expect(result.data.processes).toHaveLength(5);
  });
});
```

## Category Checklists

### Phase 1: System Metrics
- [ ] `cpuload` → `os.loadavg()` or systeminformation
- [ ] `memory` → `os.freemem()` / `os.totalmem()`
- [ ] `processes` → systeminformation `processes()`
- [ ] `uptime` → `os.uptime()`
- [ ] `hostname` → `os.hostname()`

### Phase 2: Network
- [ ] `getconnections` → PowerShell `Get-NetTCPConnection` / `ss -tanp`
- [ ] `ipconfig` → `os.networkInterfaces()`
- [ ] `arp` → PowerShell `Get-NetNeighbor` / `arp -a`
- [ ] `wifinetworks` → PowerShell `netsh wlan show networks`

### Phase 3: Browser
- [ ] `browsercookiesview` → SQLite `cookies` table
- [ ] `browserdownloadsview` → SQLite `downloads` table
- [ ] `chromepass` → DPAPI decrypt via certutil
- [ ] `browserhistry` → SQLite `urls` table

## Common Gotchas

| Issue | Solution |
|-------|----------|
| PowerShell encoding | Always output JSON; use `-NoProfile` |
| Windows path separators | Use Node's `path` module or normalize on access |
| SQLite locked (browser running) | Open as read-only; handle SQLITE_CANTOPEN gracefully |
| DPAPI requires user context | Run from user's session; admin not always enough |
| /proc parsing varies by kernel | Test on both old (4.x) and new (5.x+) kernels |
| WSL path translation | Use `/mnt/c/Users/` for Windows files from WSL |

## Debugging Commands

```bash
# Test systeminformation
npm run dev -- --action sysint --id cpuload

# Test browser extraction
sqlite3 ~/.config/google-chrome/Default/History "SELECT * FROM downloads LIMIT 5;"

# Test PowerShell
pwsh -NoProfile -Command "Get-Process | ConvertTo-Json -AsArray"

# Test /proc
cat /proc/cpuinfo | head -20
```

## File Structure After Phase 1

```
src/tools/sysint/
├── types.ts                      # ToolResponse, PlatformAdapter interface
├── adapters/
│   └── platform.ts              # isWindows(), isLinux(), isWSL()
├── system/
│   ├── cpuload.ts
│   ├── memory.ts
│   ├── processes.ts
│   ├── uptime.ts
│   └── hostname.ts
├── network/
│   ├── getconnections.ts
│   ├── ipconfig.ts
│   └── adapters/
│       ├── windows.ts
│       └── linux.ts
└── index.ts                      # Export all tools
```

## Estimated Effort per Tool

| Complexity | Time | Example |
|-----------|------|---------|
| Simple (1 API call) | 30 min | `cpuload`, `memory`, `uptime` |
| Medium (multiple sources) | 1-2 hr | `getconnections`, `getprocesses` |
| Complex (platform-specific) | 2-4 hr | `disksmartview`, `browserpasswords` |
| Stub (no implementation) | 10 min | Audio, Outlook (low-confidence) |

## Next Actions

1. **Implement template**: Create `src/tools/sysint/system/cpuload.ts` as PoC
2. **Wire to MCP**: Add route in `src/tools/sysint.ts`
3. **Test**: `npm test -- sysint.test.ts`
4. **Plan Phase 2**: Use `/gsd:plan-phase` for network category

---

Full details: See `STACK.md` in this directory.
