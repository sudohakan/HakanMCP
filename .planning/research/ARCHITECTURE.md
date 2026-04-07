# SysInt Architecture: 250 Cross-Platform System Tools in Node.js MCP

Research on optimal patterns for structuring 250+ native CLI tools (Windows + Linux) inside HakanMCP TypeScript MCP server.

## Component Boundaries

### Separation of Concerns

**Three distinct layers:**

1. **Catalog & Registry Layer** — Metadata-first design
   - `src/services/sysint/catalog.ts` — Tool metadata (name, inputs, outputs, platform support, privileges)
   - Decouples tool declarations from implementations
   - Single source of truth: `data/sysint/catalog.json` (not generated, authored)
   - Enables lazy-loading, discoverability, filtering

2. **Platform Adapter Layer** — Operating system abstractions
   - Base interface: `src/services/sysint/platforms/base.ts` (abstract class)
   - Windows impl: `src/services/sysint/platforms/windows.ts`
   - Linux impl: `src/services/sysint/platforms/linux.ts`
   - WSL bridge: detection + cross-platform path handling
   - Handles: privilege escalation, path normalization, process invocation, output parsing

3. **Tool Implementation Layer** — Category-grouped modules
   - `src/services/sysint/tools/` — organized by category (network, process, disk, etc.)
   - Each category is independently testable
   - Single responsibility: collect data, return normalized JSON
   - No GUI, no interactive features

**Coexistence with NirSoft Binary Wrapper:**

- `src/tools/nirsoft.ts` — remains as thin bridge to binary executables
- `src/services/sysint/` — new native implementations, zero binary dependency
- Both can coexist in catalog; agents choose based on availability
- Migration path: catalog marks tools as "preferred_native" with fallback to binary

### File Organization Strategy

**Recommended: Grouped by category, not by type**

```
src/services/sysint/
├── catalog.ts                    # Catalog loader + types
├── index.ts                      # Public exports
├── platforms/
│   ├── base.ts                  # AbstractSysIntPlatform
│   ├── types.ts                 # IPlatformAdapter interface
│   ├── windows.ts               # WindowsPlatform impl
│   ├── linux.ts                 # LinuxPlatform impl
│   └── index.ts                 # getPlatform(), factory
├── tools/
│   ├── system/
│   │   ├── processes.ts         # Process listing, monitoring
│   │   ├── services.ts          # Service state, control
│   │   └── index.ts             # Export all system tools
│   ├── network/
│   │   ├── connections.ts       # TCP/UDP connections, sockets
│   │   ├── routes.ts            # Routing tables, interfaces
│   │   └── index.ts
│   ├── disk/
│   │   ├── partitions.ts        # Drive/partition info
│   │   ├── usage.ts             # Directory sizes, quotas
│   │   └── index.ts
│   ├── browser/
│   │   ├── history.ts           # Browser history + cookies
│   │   ├── cache.ts             # Browser cache locations
│   │   └── index.ts
│   └── ... (8 more categories)
├── utils/
│   ├── outputFormatter.ts       # CSV → JSON, normalization
│   ├── privilegeHelper.ts       # sudo/runas wrapping
│   └── pathHelper.ts            # Windows/Linux path normalization
└── shared/
    ├── types.ts                 # Shared domain types
    └── constants.ts             # Platform-specific defaults
data/sysint/
├── catalog.json                 # 250 tool definitions
└── schemas/                     # Output validation schemas
    ├── process.json
    ├── network.json
    └── ...
```

**Why this structure:**

- **Per-category files** — each tool group is ~5-15 tools, fits in 200-400 lines
- **Parallel development** — different engineers work on different categories
- **Testability** — mock platform, test tool logic independently
- **Discoverability** — grep `src/services/sysint/tools/network/` → all network tools
- **Lazy loading** — load only categories needed by agent

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ MCP Client Request (Agent)                                       │
│ { action: "run", category: "process", tool: "list_processes" } │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ src/tools/sysint.ts — Dispatcher                                │
│ 1. Parse + validate action/category/tool/args                   │
│ 2. Check privileges (admin required?)                           │
│ 3. Route to handler                                             │
└────────────────┬────────────────────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌──────────────────┐  ┌──────────────────┐
│ Action: List     │  │ Action: Info     │
│ (enumerate tools)│  │ (tool metadata)  │
│ catalog.json     │  │ returns metadata │
│ → JSON           │  │ from registry    │
└──────────────────┘  └──────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ Action: Run — Invoke Tool                                        │
│ 1. Load tool handler: import('./tools/{category}/{tool}.ts')    │
│ 2. Detect platform (Windows/WSL/Linux)                          │
│ 3. Check privilege level, invoke platform adapter               │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
        ┌────────────────────────────────┐
        │ Platform Adapter               │
        │ (Windows/Linux impl)           │
        │                                │
        │ 1. Platform detection          │
        │ 2. Privilege escalation check  │
        │ 3. Path normalization          │
        │ 4. Command execution           │
        │ 5. Output collection           │
        └────────────┬───────────────────┘
                     │
     ┌───────────────┴────────────────┐
     │                                │
     ▼ (Windows)                     ▼ (Linux)
  PowerShell          execFile + du/ps/ip
  via exec/execFile   (no shell injection)
                     
     │                                │
     └────────────────┬────────────────┘
                      │
                      ▼
         ┌─────────────────────────┐
         │ Raw Output              │
         │ (CSV/text/JSON)         │
         └────────────┬────────────┘
                      │
                      ▼
       ┌──────────────────────────────┐
       │ Output Formatter             │
       │ - Parse CSV → JSON           │
       │ - Normalize field names      │
       │ - Type coercion (str → int)  │
       │ - Validate vs schema         │
       └────────────┬─────────────────┘
                    │
                    ▼
          ┌────────────────────┐
          │ Normalized JSON    │
          │ Validated vs       │
          │ data/sysint/       │
          │ schemas/{tool}.json│
          └────────────┬───────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │ MCP Response to Agent       │
         │ {                           │
         │   rows: [...],              │
         │   count: 42,                │
         │   schema: "process",        │
         │   timestamp: "2026-04-07"   │
         │ }                           │
         └─────────────────────────────┘
```

**Key flows:**

- **List action** → read catalog (no execution)
- **Info action** → read metadata from registry (no execution)
- **Run action** → execute → collect → format → validate → return JSON
- **Setup action** → check privileges, required tools (npcap, 7z), binary deps

---

## Platform Adapter Pattern

### Abstract Base Class

```typescript
// src/services/sysint/platforms/base.ts
export abstract class AbstractSysIntPlatform {
  // Core data collection methods
  abstract getProcessList(): Promise<ProcessInfo[]>;
  abstract getNetworkConnections(): Promise<Connection[]>;
  abstract getDrives(): Promise<DriveInfo[]>;
  // ... 50+ abstract methods
  
  // Shared utilities (non-abstract)
  async executeCommand(cmd: string, args: string[], opts?: ExecOptions): Promise<string>
  async executeWithPrivilege(cmd: string, args: string[]): Promise<string>
  normalizeColumnNames(raw: Record<string, unknown>): Record<string, unknown>
}
```

**Pattern benefits:**

- Single interface for 250 tools
- Platform-specific logic isolated to Windows/Linux classes
- Shared utilities in base (output parsing, privilege escalation)
- Easy to mock for testing

### Windows Implementation

```typescript
export class WindowsPlatform extends AbstractSysIntPlatform {
  async getProcessList(): Promise<ProcessInfo[]> {
    // PowerShell: Get-Process | Select-Object -Property ... | ConvertTo-Json
    // Privilege escalation: RunAs verb for sensitive operations
    // Handles: compat with older Windows versions, WMI fallback
  }
  
  async executeWithPrivilege(cmd: string, args: string[]): Promise<string> {
    // Wraps execFile with Start-Process -Verb RunAs
    // Returns stdout/stderr
  }
}
```

**Windows-specific patterns:**

- **PowerShell for data collection** — native Windows objects → JSON
- **RunAs verb** — privilege escalation without UAC popup (when already elevated)
- **WMI fallback** — for Get-Process when PowerShell methods unavailable
- **Registry access** — via reg.exe or PowerShell registry provider
- **Timeout handling** — Set-Variable ERRORACTIONPREFERENCE to stop on timeout

### Linux Implementation

```typescript
export class LinuxPlatform extends AbstractSysIntPlatform {
  async getProcessList(): Promise<ProcessInfo[]> {
    // ps aux OR /proc/$$/stat parsing
    // Supports: cgroup isolation, container detection
  }
  
  async executeWithPrivilege(cmd: string, args: string[]): Promise<string> {
    // Check current UID; if not root, try sudo
    // Requires no-password sudo or polkit integration
  }
}
```

**Linux-specific patterns:**

- **/proc filesystem** — no exec needed, pure file reading (fast)
- **sudo with no-password entries** — polkit or sudoers config
- **cgroup detection** — identify if running in container
- **systemd journal** — service logs via journalctl
- **netstat/ss** — network connections (ss preferred, netstat deprecated)

### WSL Bridge

```typescript
// src/services/sysint/platforms/wsl.ts
export class WSLBridge extends LinuxPlatform {
  // Uses Linux native tools via WSL Linux kernel
  // Falls back to Windows PowerShell for registry, services
  
  async getProcessList(): Promise<ProcessInfo[]> {
    // First try Linux /proc
    // If that fails, fall back to Windows Get-Process
  }
}
```

**WSL-specific decisions:**

- **Default to Linux tools** — WSL kernel provides /proc, /sys
- **Cross-boundary fallback** — if Linux tool unavailable, call Windows PowerShell via cmd.exe
- **Path conversion** — /mnt/c/Users → C:\\Users for Windows tools

---

## Tool Organization

### 10 Categories → 250 Tools

| Category | Count | Examples | Complexity |
|----------|-------|----------|-----------|
| System | 74 | CPU/memory, services, startup programs, event logs | High (WMI, registry) |
| Network | 63 | Connections, routing, DNS, sockets, interfaces | High (netstat, ipconfig) |
| Process | 15 | List, monitor, kill, priority, threads | Medium |
| Disk | 17 | Partitions, usage, SMART, disk I/O, file handles | High (diskpart, smartctl) |
| Browser | 24 | History, cache, cookies, extensions (Chrome, Firefox, Edge) | High (SQLite parsing) |
| Password | 21 | Stored credentials, DPAPI decryption | Critical (security-sensitive) |
| Registry | 10 | Registry value enumeration, type coercion | Windows-only |
| Outlook | 6 | Email history, PST parsing | Medium (file format parsing) |
| Audio | 4 | Audio devices, volume levels | Low |
| Programmer | 15 | Environment vars, git info, compiler paths | Low |

### Per-Category Module Structure

Each category module follows same pattern:

```typescript
// src/services/sysint/tools/system/processes.ts
import { AbstractSysIntPlatform } from '../../platforms/base.js';
import type { ProcessInfo } from '../../shared/types.js';

export async function listProcesses(
  platform: AbstractSysIntPlatform,
  args: { filter?: string; sort?: string }
): Promise<ProcessInfo[]> {
  const processes = await platform.getProcessList();
  
  if (args.filter) {
    return processes.filter(p => p.name.includes(args.filter));
  }
  return processes;
}

export const processToolDefinitions = [
  {
    id: 'system_list_processes',
    name: 'List Processes',
    description: '...',
    platforms: ['windows', 'linux', 'wsl'],
    adminRequired: false,
    inputSchema: { ... },
  },
];
```

**Advantages:**

- Each category is ~5-15 tool definitions
- Single category file is ~300 lines max (testable unit)
- Tool factory generates MCP ToolDefinition from metadata
- Shared platform adapter — no platform-specific code in tools

---

## Lazy Loading Strategy for 250+ Tools

### Three-Phase Loading

**Phase 1: Metadata-only (startup)**

```typescript
// src/tools/sysint.ts
async function handleList(action: 'list' | 'info'): Promise<unknown> {
  // Load only catalog.json (50KB JSON)
  // Return tool list with metadata
  // Handler: null (not loaded yet)
  const catalog = loadCatalog(CATALOG_PATH);
  return catalog.tools.map(t => ({
    id: t.id,
    name: t.name,
    platforms: t.platforms,
    adminRequired: t.adminRequired,
  }));
}
```

**Phase 2: Category load (on first tool use)**

```typescript
async function handleRun(toolId: string, args: unknown): Promise<unknown> {
  const category = getCategoryForTool(toolId);
  
  // Load category handler (first use only, cached)
  if (!categoryHandlers[category]) {
    const module = await import(`./tools/${category}/index.js`);
    categoryHandlers[category] = module;
  }
  
  // Get handler for specific tool
  const handler = categoryHandlers[category].getHandler(toolId);
  return handler(args);
}
```

**Phase 3: Handler invocation**

- Platform adapter instantiated once (singleton)
- Tool handler receives platform + args
- Returns normalized JSON

### Catalog Structure

```json
{
  "version": 1,
  "platforms": ["windows", "linux", "wsl"],
  "categories": ["system", "network", "disk", ...],
  "tools": [
    {
      "id": "system_list_processes",
      "category": "system",
      "name": "List Processes",
      "description": "Enumerate running processes with detailed metrics",
      "platforms": ["windows", "linux", "wsl"],
      "adminRequired": false,
      "outputSchema": "process",
      "inputSchema": {
        "type": "object",
        "properties": {
          "filter": { "type": "string" },
          "sort": { "enum": ["name", "pid", "memory", "cpu"] }
        }
      },
      "timeout": 30,
      "estimatedCost": "low",
      "examples": [
        { "input": {}, "output": "returns all processes" },
        { "input": {"filter": "chrome"}, "output": "filtered by name" }
      ]
    },
    ...
  ]
}
```

### Memory Profile

- Startup: catalog.json loaded (50KB), handlers unloaded (0KB)
- Agent lists tools: ~20KB in memory (metadata)
- Agent runs network tool: +150KB (network category loaded)
- Agent runs disk tool: +120KB (disk category loaded)
- Total: ~340KB for network + disk tools

**vs. eager loading all 250 tools: ~2-3MB**

---

## Integration with Existing Code

### Coexistence with Binary NirSoft Wrapper

**Current state:**
- `src/tools/nirsoft.ts` — binary executable wrapper
- `data/nirsoft/catalog.json` — 245 tools, Windows-only
- HakanMCP already has infrastructure for this

**Integration strategy:**

1. **Keep nirsoft.ts unchanged** — backwards compatible
2. **Add sysint.ts alongside** — new native implementation
3. **Unified tool discovery** — combine catalogs in agent's perspective
4. **Smart routing** — prefer native when available

```typescript
// src/tools/index.ts (pseudo)
const nirsoftCatalog = loadCatalog('./data/nirsoft/catalog.json');
const sysintCatalog = loadCatalog('./data/sysint/catalog.json');

// Agents see both
export const allSystemTools = {
  ...nirsoftTools,           // nirsoft: prefix
  ...sysintTools,            // sysint: prefix
};
```

**Or: unified dispatcher**

```typescript
// Single nirsoft tool that tries both implementations
async function nirsoftRun(toolId: string) {
  // First try native SysInt implementation
  if (sysintCatalog.has(toolId)) {
    return sysintRun(toolId);
  }
  // Fall back to binary
  return binaryNirsoftRun(toolId);
}
```

### Reuse Existing Patterns

**Platform adapter pattern** — already used in `src/services/disk/`:

```typescript
// Disk service uses similar strategy:
import { getPlatform } from './platforms/index.js';

const platform = getPlatform(); // Windows or Linux
const drives = await platform.getDrives();
```

Reapply exact pattern for SysInt:

```typescript
import { getPlatform } from './platforms/index.js';

const platform = getPlatform();
const processes = await platform.getProcessList();
```

**Tool factory pattern** — already used for all tools:

```typescript
// Use existing createTool from toolFactory.ts
export const sysintTools = [
  createTool({
    name: 'sysint',
    description: '...',
    inputSchema: SysIntArgsSchema,
    handler: handleSysIntAction,
  }),
];
```

**Tool registry** — add to FEATURE_TOOL_MAP:

```typescript
export const FEATURE_TOOL_MAP: Record<string, FeatureModule> = {
  // ... existing tools
  sysint: {
    modulePath: './tools/sysint.js',
    exportName: 'sysintTools',
    nativeDeps: [],
    core: false,
    featureName: 'sysint'
  },
};
```

---

## Suggested Build Order

### Phase 1: Foundation (Week 1)

**Goals:** Infrastructure, platform layer, output formatting

1. **Platform abstraction** (3 days)
   - `src/services/sysint/platforms/base.ts` — abstract class + types
   - `src/services/sysint/platforms/windows.ts` — PowerShell basics (Get-Process, Get-NetTCPConnection)
   - `src/services/sysint/platforms/linux.ts` — /proc file reading (ps, ss, df)
   - `src/services/sysint/platforms/index.ts` — factory + WSL detection
   
   **Testing:** Mock platform, verify interface contract

2. **Catalog loader + dispatcher** (2 days)
   - `src/services/sysint/catalog.ts` — load/validate catalog.json
   - `src/tools/sysint.ts` — action dispatcher (list, info, run)
   - Register in FEATURE_TOOL_MAP
   
   **Testing:** Load empty catalog, handle missing tools

3. **Output formatting + validation** (2 days)
   - `src/services/sysint/utils/outputFormatter.ts` — CSV → JSON, type coercion
   - `data/sysint/schemas/*.json` — Zod schemas for each tool output
   - Validator in dispatcher
   
   **Testing:** Parse sample outputs, validate against schema

### Phase 2: High-Value Categories (Weeks 2-3)

**Goals:** 60% of tools (150+ tools) with native support

Build categories in this order (dependencies → high-usage):

1. **Process tools** (3 days) — 15 tools
   - `src/services/sysint/tools/process/`
   - Depends on: platform.getProcessList()
   - High usage: agents frequently check running processes
   
2. **Network tools** (5 days) — 63 tools (largest category)
   - `src/services/sysint/tools/network/`
   - Depends on: platform.getNetworkConnections(), getInterfaces(), getRoutes()
   - High complexity: TCP/UDP connections, DNS resolution, routing tables
   
3. **Disk tools** (4 days) — 17 tools
   - `src/services/sysint/tools/disk/`
   - Depends on: platform.getDrives(), getDirectorySize()
   - Moderate complexity: SMART status, disk I/O stats
   
4. **System tools** (6 days) — 74 tools (highest complexity)
   - `src/services/sysint/tools/system/`
   - Depends on: WMI, registry, event logs, services
   - Complex: requires multiple platform APIs, privilege escalation
   - **Prioritize subset:** services, CPU/memory, startup programs (top 20 of 74)

### Phase 3: Medium-Value Categories (Week 4)

1. **Browser tools** (5 days) — 24 tools
   - SQLite parsing (Chrome, Edge history/cookies)
   - Registry reading (Firefox profiles)
   - Windows-heavy; skip on Linux for now
   
2. **Programmer tools** (2 days) — 15 tools
   - Environment variables, git info, compiler paths
   - Mostly file/env reading, cross-platform

3. **Audio tools** (1 day) — 4 tools
   - Audio devices, volume (WMI on Windows, alsamixer on Linux)

### Phase 4: Security-Sensitive (Week 5)

1. **Password tools** (7 days) — 21 tools
   - DPAPI decryption on Windows (requires elevated privileges)
   - Stored browser credentials, Windows credential manager
   - **Security audit required** before release
   - Start with read-only enumeration, no extraction

2. **Registry tools** (3 days) — 10 tools
   - Windows-only, depends on reg.exe or PowerShell registry provider

### Phase 5: Specialization (Week 6+)

1. **Outlook tools** (2 days) — 6 tools
   - PST file parsing, Outlook stored rules

2. **Polish + hardening**
   - Error handling, timeout enforcement, privilege checks
   - Integration tests on real Windows + Linux
   - Performance optimization (caching, batching)

### Dependency Graph

```
Foundation (Week 1)
├─ Platform layer (base + Windows + Linux)
├─ Catalog loader
└─ Output formatter
  │
  ├─→ Process tools (easy)
  │
  ├─→ Network tools (needs advanced platform APIs)
  │   └─→ requires platform.getNetworkConnections()
  │
  ├─→ Disk tools (needs advanced platform APIs)
  │
  ├─→ System tools (needs WMI + registry)
  │   └─→ requires platform.getWmiObject(), getRegistryValue()
  │
  ├─→ Browser tools (needs file parsing)
  │
  ├─→ Audio tools (needs device APIs)
  │
  ├─→ Programmer tools (needs env + file reading)
  │
  └─→ Password tools (needs privilege escalation)
```

### Success Criteria Per Phase

**Phase 1:**
- [ ] Platform abstraction compiles and runs
- [ ] Catalog loads without errors
- [ ] Mock platform test passes

**Phase 2:**
- [ ] 60+ tools implemented
- [ ] Process + network + disk categories fully working
- [ ] Cross-platform testing (Windows + WSL + Linux)
- [ ] Output validation against schemas

**Phase 3:**
- [ ] 150+ tools total
- [ ] Browser category working (Windows)
- [ ] Lazy loading verified (not all categories loaded at startup)

**Phase 4:**
- [ ] Password category implemented
- [ ] Security audit passed
- [ ] Privilege escalation tested

**Phase 5:**
- [ ] All 250 tools implemented
- [ ] E2E integration tests
- [ ] Performance benchmarks
- [ ] Documentation complete

---

## Key Design Decisions

| Decision | Rationale | Trade-offs |
|----------|-----------|-----------|
| **Category-grouped files (not per-tool)** | Reduces file count from 250 to 10, keeps files under 400 lines | Slightly harder to find individual tool code (mitigated by clear naming) |
| **Abstract base class** | Single interface ensures all platforms implement same API | More boilerplate, but forces consistency |
| **Metadata-first catalog** | Enables discoverability without loading 250 handlers | Catalog must be kept in sync with code (mitigation: validate at startup) |
| **Lazy-load by category** | Balances fast startup with avoiding 250 small imports | Tools in same category always loaded together (acceptable tradeoff) |
| **JSON output always** | Agents prefer structured data, avoids parsing text | Some info loss compared to raw output (mitigated by schema design) |
| **Separate from NirSoft wrapper** | Backwards compatibility, clear architecture | Agents must choose which implementation to use (mitigated by unified dispatcher) |
| **No interactive/real-time** | Single-shot tool invocation, no streaming | Agents can't monitor processes live (acceptable for CLI tools) |

---

## Implementation Checklist

Foundation:
- [ ] Create `src/services/sysint/platforms/base.ts` with abstract class
- [ ] Implement `src/services/sysint/platforms/windows.ts` (Get-Process, Get-NetTCPConnection)
- [ ] Implement `src/services/sysint/platforms/linux.ts` (/proc reading)
- [ ] Implement `src/services/sysint/platforms/index.ts` (factory + platform detection)
- [ ] Create `src/services/sysint/catalog.ts` (loader, validation)
- [ ] Create `src/tools/sysint.ts` (dispatcher, handlers)
- [ ] Create `src/services/sysint/utils/outputFormatter.ts`
- [ ] Create `data/sysint/catalog.json` (tool metadata)
- [ ] Create `data/sysint/schemas/` (Zod output validators)

Category skeleton (per category):
- [ ] Create `src/services/sysint/tools/{category}/index.ts`
- [ ] Implement tool handlers
- [ ] Add test file `src/__tests__/sysint-{category}.test.ts`

Testing:
- [ ] Unit tests for platform adapters (mock platform)
- [ ] Integration tests for 2-3 tools per category
- [ ] Cross-platform tests (Windows + Linux + WSL)
- [ ] E2E test: agent calls sysint tool via MCP

Documentation:
- [ ] ARCHITECTURE.md (this file)
- [ ] IMPLEMENTATION.md (per-category guides)
- [ ] PLATFORMS.md (Windows/Linux-specific patterns)
- [ ] API.md (tool catalog + examples)

---

## References

- NirSoft catalog patterns: `data/nirsoft/catalog.json`
- Disk service platform adapter: `src/services/disk/platforms/`
- Tool factory: `src/utils/toolFactory.ts`
- Tool registry: `src/toolRegistry.ts`
- Existing nirsoft implementation: `src/tools/nirsoft.ts`

---

*Last updated: 2026-04-07*
*Status: Research phase complete. Ready for Phase 1 (Foundation) implementation.*
