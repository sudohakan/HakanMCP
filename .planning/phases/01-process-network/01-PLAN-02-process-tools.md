---
plan: "02"
wave: 1
depends_on: ["01"]
files_modified:
  - src/services/sysint/tools/process.ts
  - src/services/sysint/__tests__/process.test.ts
autonomous: true
requirements:
  - PRC-01
  - PRC-02
  - PRC-03
  - PRC-04
  - PRC-05
  - PRC-06
  - PRC-07
  - PRC-08
---

# Plan 02: Process Tools (PRC-01..08)

**Goal:** All 8 process tools implemented with unit tests. Process list includes PID, name, CPU%, memory, user, command line. Process-to-connection mapping correlates PIDs.

**Wave 1** — runs in parallel with Plan 03.

---

## Context

- Foundation: `buildSuccess`, `buildError`, `getPlatformName` from Phase 0
- `systeminformation` installed in Plan 01
- Fixtures in `src/services/sysint/__tests__/fixtures/` from Plan 01
- Module loads via `getCategoryModule('process')` in dispatcher
- File: single `src/services/sysint/tools/process.ts` (all 8 tools, ~400 lines)

---

## Tasks

<task id="1-02-01" title="Scaffold process.ts module with TDD stubs (RED)">

**What:** Create `src/services/sysint/tools/process.ts` with the module interface and all 8 handler stubs. Create `src/services/sysint/__tests__/process.test.ts` with failing tests for each tool.

**Module skeleton:**
```typescript
// src/services/sysint/tools/process.ts
import { buildSuccess, buildError } from '../outputFormatter.js';
import { getPlatformName } from '../platforms/index.js';
import type { SysIntResult } from '../outputFormatter.js';

export interface ProcessRow {
  pid: number;
  name: string;
  cpu: number;
  memoryBytes: number;
  user: string;
  commandLine: string;
}

export interface ConnectionMappingRow {
  pid: number;
  processName: string;
  protocol: 'TCP' | 'UDP';
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
}

// ... other row interfaces ...

const TOOL_HANDLERS: Record<string, (args: string[]) => Promise<SysIntResult>> = {
  'process-list': runProcessList,
  'process-connections': runProcessConnections,
  'process-modules': runProcessModules,
  'process-threads': runProcessThreads,
  'process-handles': runProcessHandles,
  'process-io': runProcessIO,
  'process-tree': runProcessTree,
  'service-list': runServiceList,
};

export async function run(toolId: string, args: string[] = []): Promise<SysIntResult> {
  const handler = TOOL_HANDLERS[toolId];
  if (!handler) return buildError(`No native handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
  return handler(args);
}
```

**Test file stubs** (RED — all should fail initially):
```typescript
// Each tool: happy path + empty result + exec failure
describe('process-list (PRC-01)', () => {
  it('returns ProcessRow[] with pid, name, cpu, memoryBytes, user, commandLine', async () => {
    // mock si.processes() with fixture
    // assert row shape
  });
});
// ... repeat for each tool ...
```

<automated>npx jest --testPathPattern="process" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-02-02" title="Implement PRC-01: process-list and PRC-07: process-tree (GREEN)">

**What:** Implement `runProcessList` using `systeminformation.processes()` and `runProcessTree` from PPID relationships.

**PRC-01 implementation:**
```typescript
import si from 'systeminformation';

async function runProcessList(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.processes();
    const rows: ProcessRow[] = data.list.map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round(p.cpu * 10) / 10,
      memoryBytes: p.mem_rss ?? 0,
      user: p.user,
      commandLine: [p.command, p.params].filter(Boolean).join(' '),
    }));
    return buildSuccess(rows, 'process-list', platform);
  } catch (err) {
    return buildError(`process-list failed: ${String(err)}`, 'EXEC_FAILED', 'process-list');
  }
}
```

**PRC-07 implementation:**
```typescript
async function runProcessTree(_args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  try {
    const data = await si.processes();
    const byPid = new Map(data.list.map((p) => [p.pid, { ...p, children: [] as number[] }]));
    for (const p of data.list) {
      if (p.parentPid && byPid.has(p.parentPid)) {
        byPid.get(p.parentPid)!.children.push(p.pid);
      }
    }
    const rows = [...byPid.values()].map((p) => ({
      pid: p.pid,
      parentPid: p.parentPid,
      name: p.name,
      children: p.children,
    }));
    return buildSuccess(rows, 'process-tree', platform);
  } catch (err) {
    return buildError(`process-tree failed: ${String(err)}`, 'EXEC_FAILED', 'process-tree');
  }
}
```

<automated>npx jest --testPathPattern="process" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-02-03" title="Implement PRC-02: process-connections (GREEN)">

**What:** Implement `runProcessConnections` — correlate TCP/UDP connections with process list.

**Implementation strategy:** Run process list + connection listing together, join on PID.

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);

async function runProcessConnections(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const targetPid = args[0] ? parseInt(args[0], 10) : undefined;

  try {
    const connections = platform === 'win32' || platform === 'wsl'
      ? await getConnectionsWindows()
      : await getConnectionsLinux();

    const filtered = targetPid
      ? connections.filter((c) => c.pid === targetPid)
      : connections;

    return buildSuccess(filtered, 'process-connections', platform);
  } catch (err) {
    return buildError(`process-connections failed: ${String(err)}`, 'EXEC_FAILED', 'process-connections');
  }
}

async function getConnectionsWindows(): Promise<ConnectionMappingRow[]> {
  const { stdout } = await execAsync('netstat -ano', { timeout: 30_000 });
  return parseNetstatWindows(stdout);
}

function parseNetstatWindows(output: string): ConnectionMappingRow[] {
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  const rows: ConnectionMappingRow[] = [];
  for (const line of lines) {
    const match = line.trim().match(/^(TCP|UDP)\s+(\S+)\s+(\S+)\s+(\w+)\s+(\d+)/);
    if (!match) continue;
    const [, protocol, local, remote, state, pid] = match;
    const [localAddr, localPortStr] = local.includes(':') ? [local.slice(0, local.lastIndexOf(':')), local.slice(local.lastIndexOf(':') + 1)] : [local, '0'];
    const [remoteAddr, remotePortStr] = remote.includes(':') ? [remote.slice(0, remote.lastIndexOf(':')), remote.slice(remote.lastIndexOf(':') + 1)] : [remote, '0'];
    rows.push({
      pid: parseInt(pid, 10),
      processName: '',  // enriched separately if needed
      protocol: protocol as 'TCP' | 'UDP',
      localPort: parseInt(localPortStr, 10),
      remoteAddress: remoteAddr,
      remotePort: parseInt(remotePortStr, 10),
      state: protocol === 'UDP' ? '' : state,
    });
  }
  return rows;
}
```

**Tests:** Mock `exec` with `netstat-windows.txt` fixture; verify row shape; test PID filter arg.

<automated>npx jest --testPathPattern="process" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-02-04" title="Implement PRC-03..06: modules, threads, handles, IO (GREEN)">

**What:** Implement the 4 process-detail tools.

**PRC-03 — process-modules:**
- Windows: `powershell -NoProfile -Command "Get-Process -Id {PID} | Select-Object -Expand Modules | Select-Object -Property ModuleName,FileName,FileVersion | ConvertTo-Json"` — parse JSON
- Linux: Read `/proc/{pid}/maps`, extract unique lib paths

**PRC-04 — process-threads:**
- Windows: Same PowerShell command with `.Threads` property
- Linux: `ls /proc/{pid}/task/` — returns thread IDs

**PRC-05 — process-handles:**
- Windows: `Get-Process -Id {PID} | Select-Object Handles,HandleCount` (count only — no per-handle enumeration without admin)
- Linux: `ls /proc/{pid}/fd/` — list FD numbers; read each symlink for path

**PRC-06 — process-io:**
- Windows: `Get-Process -Id {PID} | Select-Object Id,Name,WorkingSet64,PagedMemorySize64 | ConvertTo-Json` (IO counters unavailable without admin)
- Linux: Read `/proc/{pid}/io` — `read_bytes` and `write_bytes` fields

All 4: `args[0]` = PID (required). Return EXEC_FAILED if no PID provided.

**Tests:** Mock PowerShell/proc reads with fixture data. Test missing-PID case.

<automated>npx jest --testPathPattern="process" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

<task id="1-02-05" title="Implement PRC-08: service-list (GREEN)">

**What:** Implement `runServiceList`.

**Windows/WSL:**
```typescript
const ps = `Get-Service | Select-Object -Property Name,DisplayName,Status,StartType | ConvertTo-Json`;
const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 30_000 });
const services = JSON.parse(stdout.trim());
```

Status mapping: `4 = Running, 1 = Stopped, 2 = StartPending, 3 = StopPending`

**Linux:**
```typescript
const { stdout } = await execAsync('systemctl list-units --type=service --output=json --no-pager', { timeout: 30_000 });
const units = JSON.parse(stdout.trim());
```

Row schema:
```typescript
interface ServiceRow {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'pending' | 'unknown';
  startType: 'auto' | 'manual' | 'disabled' | 'unknown';
}
```

**Tests:** Mock exec with `get-service-windows.txt` and `systemctl-services-linux.txt` fixtures. Verify status mapping.

<automated>npx jest --testPathPattern="process" --no-coverage 2>&1 | grep -E "(PASS|FAIL|Tests:)" | tail -5</automated>

</task>

---

## Verification Criteria

- [ ] `src/services/sysint/tools/process.ts` exists and exports `run()`
- [ ] `npx jest --testPathPattern="process" --no-coverage` — all tests GREEN
- [ ] All 8 PRC-* tool IDs are handled in `TOOL_HANDLERS` map
- [ ] `runTool('process-list')` via dispatcher returns `SysIntSuccess` shape (not error)
- [ ] `runTool('process-connections', ['1234'])` returns filtered rows
- [ ] `npx tsc --noEmit` — no TypeScript errors

## Must-Haves

For Phase 1 success criteria:
- `process-list` rows include all 6 fields: pid, name, cpu, memoryBytes, user, commandLine
- `process-connections` rows include processName (PID correlated) OR at minimum pid field
