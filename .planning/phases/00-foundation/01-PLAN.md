---
phase: 00-foundation
plan: 01
wave: 1
type: tdd
depends_on: []
files_modified:
  - src/services/sysint/platforms/abstract.ts
  - src/services/sysint/platforms/windows.ts
  - src/services/sysint/platforms/linux.ts
  - src/services/sysint/platforms/wsl.ts
  - src/services/sysint/platforms/index.ts
  - src/services/sysint/catalog/types.ts
  - src/services/sysint/catalog/loader.ts
  - data/sysint/catalog.json
  - src/services/sysint/__tests__/platforms.test.ts
  - src/services/sysint/__tests__/catalog.test.ts
autonomous: true
requirements:
  - FND-01
  - FND-02
---

<objective>
Implement the platform abstraction layer (AbstractSysIntPlatform + Windows/Linux/WSL impls) and the SysInt catalog loader with 250 tool definitions.

Purpose: TDD forces the platform API contract to be defined upfront. Platform detection and catalog loading are pure, testable functions with defined inputs/outputs — perfect TDD candidates.

Output: Working platform detection, singleton factory with test reset, and catalog loader validated against data/sysint/catalog.json.
</objective>

<context>
@.planning/phases/00-foundation/00-CONTEXT.md
@.planning/phases/00-foundation/00-RESEARCH.md
@src/services/nirsoft/platform.ts
@src/services/nirsoft/catalog.ts
@data/nirsoft/catalog.json
@src/utils/projectRoot.ts
</context>

<tasks>

<task type="auto" id="01-01">
  <name>Create data/sysint/catalog.json</name>
  <files>data/sysint/catalog.json</files>
  <action>
    Create the SysInt catalog at data/sysint/catalog.json based on the nirsoft catalog schema, extended with sysint-specific fields.

    Schema for each tool entry:
    ```json
    {
      "id": "string",           // same ID as nirsoft where applicable
      "name": "string",
      "description": "string",
      "category": "string",     // network|process|disk|system|browser|password|registry|outlook|audio|programmer
      "adminRequired": false,
      "timeout": 30,
      "native": false,          // ALL tools start as native:false in Phase 0
      "platforms": ["win32", "linux", "wsl"]  // default all platforms; Windows-only tools omit linux
    }
    ```

    Populate with all 250 tools from data/nirsoft/catalog.json mapped to this schema. Tools that are Windows-only (registry, DPAPI passwords, etc.) get `"platforms": ["win32", "wsl"]`. Cross-platform tools get `"platforms": ["win32", "linux", "wsl"]`.

    Catalog version: 1. Categories array matches nirsoft: ["network", "password", "browser", "system", "disk", "process", "registry", "outlook", "audio", "programmer"].

    All tools start with `"native": false` — Phase 1+ plans flip individual tools to true as implementations land.
  </action>
  <verify>
    python3 -c "
    import json
    with open('data/sysint/catalog.json') as f:
        c = json.load(f)
    assert c['version'] == 1
    assert len(c['tools']) >= 250
    assert all('native' in t and 'platforms' in t for t in c['tools'])
    print(f'OK: {len(c[\"tools\"])} tools, all have native+platforms fields')
    "
  </verify>
  <done>data/sysint/catalog.json created with 250 tool definitions</done>
</task>

<task type="tdd" id="01-02">
  <name>TDD: Catalog types and loader</name>
  <files>
    src/services/sysint/catalog/types.ts
    src/services/sysint/catalog/loader.ts
    src/services/sysint/__tests__/catalog.test.ts
  </files>
  <feature>
    <name>SysInt catalog loader</name>
    <files>src/services/sysint/catalog/loader.ts, src/services/sysint/__tests__/catalog.test.ts</files>
    <behavior>
      loadSysIntCatalog(path) → parses JSON, validates structure, returns SysIntCatalog

      Cases:
      - loadSysIntCatalog(validPath) → { version: 1, categories: [...], tools: [...250 items] }
      - loadSysIntCatalog(missingPath) → throws Error "Failed to parse catalog at ..."
      - loadSysIntCatalog(wrongVersionPath) → throws Error "Unsupported catalog version: 2"
      - tool without required fields → throws Error "Invalid catalog entry: ..."

      getCatalog() (singleton):
      - First call → loads from PROJECT_ROOT/data/sysint/catalog.json
      - Second call → returns same cached instance (no re-read)
      - After resetCatalog() → next call loads fresh copy
    </behavior>
    <implementation>
      1. Define SysIntTool interface in catalog/types.ts (extends NirsoftTool fields + native: boolean + platforms: string[])
      2. Define SysIntCatalog interface: { version: number, categories: string[], tools: SysIntTool[] }
      3. loadSysIntCatalog(path): sync readFileSync + JSON.parse, validate version and tool fields
      4. Module-level _catalog singleton + getCatalog() factory + resetCatalog() for tests
    </implementation>
  </feature>
  <verification>npm test -- --testPathPattern=catalog --verbose</verification>
  <success_criteria>
    - Failing test written and committed
    - Implementation passes all test cases
    - getCatalog() memoization verified in tests
    - All 3 TDD commits present
  </success_criteria>
  <done>Catalog loader fully tested and passing</done>
</task>

<task type="tdd" id="01-03">
  <name>TDD: Platform abstraction and factory</name>
  <files>
    src/services/sysint/platforms/abstract.ts
    src/services/sysint/platforms/windows.ts
    src/services/sysint/platforms/linux.ts
    src/services/sysint/platforms/wsl.ts
    src/services/sysint/platforms/index.ts
    src/services/sysint/__tests__/platforms.test.ts
  </files>
  <feature>
    <name>Platform adapter factory</name>
    <files>src/services/sysint/platforms/index.ts, src/services/sysint/__tests__/platforms.test.ts</files>
    <behavior>
      getPlatform() → returns platform singleton appropriate for current environment

      Cases:
      - On win32 (process.platform === 'win32') → WindowsPlatform instance with name='win32'
      - On Linux with WSLInterop → WSLPlatform instance with name='wsl'
      - On Linux without WSLInterop → LinuxPlatform instance with name='linux'
      - Multiple calls to getPlatform() → same object reference (===)
      - After _resetPlatform() → next call returns fresh instance

      getPlatformName() utility:
      - Returns 'wsl' | 'linux' | 'win32' based on current environment
      - isWSL() result takes precedence over process.platform === 'linux'
    </behavior>
    <implementation>
      1. abstract.ts: AbstractSysIntPlatform abstract class with readonly name: 'win32'|'linux'|'wsl'
      2. windows.ts: WindowsPlatform extends AbstractSysIntPlatform, name='win32'
      3. linux.ts: LinuxPlatform extends AbstractSysIntPlatform, name='linux'
      4. wsl.ts: WSLPlatform extends LinuxPlatform, name='wsl'
      5. index.ts: detectPlatform() factory + getPlatform() singleton + _resetPlatform() test escape hatch
         - Import isWSL from src/services/nirsoft/platform.ts (do NOT re-implement)
         - Detection order: process.platform === 'win32' → WindowsPlatform; isWSL() → WSLPlatform; else → LinuxPlatform
      6. getPlatformName() helper that returns the name string
    </implementation>
  </feature>
  <verification>npm test -- --testPathPattern=platforms --verbose</verification>
  <success_criteria>
    - Failing test written and committed
    - Platform detection logic passes all cases
    - Singleton + reset verified in tests (tests mock process.platform and isWSL)
    - All 3 TDD commits present
  </success_criteria>
  <done>Platform abstraction fully tested and passing</done>
</task>

</tasks>

<verification>
npm test -- --testPathPattern=sysint --verbose
</verification>

<must_haves>
- data/sysint/catalog.json exists with 250+ tools, all having `native` and `platforms` fields
- getCatalog() returns catalog without re-reading on second call
- getPlatform() returns the correct platform class for current environment
- _resetPlatform() allows test isolation
- SysIntTool interface exported from catalog/types.ts with native+platforms fields
- No duplication of isWSL() — imports from nirsoft/platform.ts
</must_haves>
