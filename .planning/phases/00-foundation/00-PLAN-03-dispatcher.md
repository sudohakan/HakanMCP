---
phase: 00-foundation
plan: 03
wave: 2
type: tdd
depends_on:
  - "00-PLAN-01-platform-catalog"
  - "00-PLAN-02-helpers"
files_modified:
  - src/services/sysint/dispatcher.ts
  - src/tools/sysint.ts
  - src/toolRegistry.ts
  - src/index.ts
  - src/services/sysint/__tests__/dispatcher.test.ts
  - src/tools/__tests__/sysint.test.ts
autonomous: true
requirements:
  - FND-04
  - FND-07
  - FND-08
---

<objective>
Implement the unified dispatcher (native-first with NirSoft fallback) and the sysint MCP tool (list/info/run actions). Registers sysint in toolRegistry.ts alongside nirsoft.

Purpose: TDD ensures the API contract (actions, arg validation, error codes) matches the nirsoft tool's shape exactly. The dispatcher's native→fallback logic is purely testable by injecting mocked category modules.

Output: Working sysint MCP tool callable via Claude, with list/info/run actions. All FND-04, FND-07, FND-08 requirements verified.
</objective>

<context>
@.planning/phases/00-foundation/00-CONTEXT.md
@.planning/phases/00-foundation/00-RESEARCH.md
@src/tools/nirsoft.ts
@src/toolRegistry.ts
@src/index.ts
@src/services/sysint/platforms/index.ts
@src/services/sysint/catalog/loader.ts
@src/services/sysint/outputFormatter.ts
@src/services/sysint/privilegeHelper.ts
@src/types/index.ts
@src/utils/common.ts
</context>

<tasks>

<task type="tdd" id="03-01">
  <name>TDD: Unified dispatcher</name>
  <files>
    src/services/sysint/dispatcher.ts
    src/services/sysint/__tests__/dispatcher.test.ts
  </files>
  <feature>
    <name>Native-first dispatcher with NirSoft fallback</name>
    <files>src/services/sysint/dispatcher.ts, src/services/sysint/__tests__/dispatcher.test.ts</files>
    <behavior>
      runTool(toolId, args, options?) → Promise&lt;SysIntSuccess | SysIntError&gt;:

      Guard sequence (fail-fast):
      - Tool not in catalog → { error: '...', code: 'NOT_FOUND', tool: toolId }
      - Platform not supported → { error: '...', code: 'PLATFORM_UNSUPPORTED', tool: toolId }
      - Privilege insufficient → { error: '...', code: 'PRIVILEGE_REQUIRED', tool: toolId }

      Native-first logic:
      - tool.native=true → load category module, call handler → return SysIntSuccess
      - tool.native=false → nirsoft fallback → return result from nirsoft (or EXEC_FAILED)
      - tool.native=true but category module throws → fall back to nirsoft (graceful degradation)

      Category module caching (lazy load):
      - First call for category 'network' → dynamic import + cache in Map
      - Second call for category 'network' → same cached module (no re-import)
      - Parallel calls for same category → both await same Promise (no duplicate imports)

      resetDispatcher() → clears module cache (for tests)
    </behavior>
    <implementation>
      1. Import getCatalog from catalog/loader.ts
      2. Import getPlatform, getPlatformName from platforms/index.ts
      3. Import requirePrivilege, requirePlatform from privilegeHelper.ts
      4. Import buildSuccess, buildError from outputFormatter.ts
      5. _categoryModules: Map&lt;string, Promise&lt;CategoryModule&gt;&gt; (Promise-cached, not value-cached)
      6. getCategoryModule(category): check Map → if missing, create import Promise, store in Map, await
      7. nirsoftFallback(tool, args): import nirsoft handler and run (or return EXEC_FAILED if unavailable)
      8. runTool(): guards → native attempt → fallback
      9. resetDispatcher() export
    </implementation>
  </feature>
  <verification>npx vitest run src/services/sysint/__tests__/dispatcher.test.ts --reporter=verbose</verification>
  <success_criteria>
    - Guard sequence order verified (NOT_FOUND before PLATFORM_UNSUPPORTED before PRIVILEGE_REQUIRED)
    - Native module caching: import called once for parallel requests (spy on import)
    - Fallback triggered when native throws
    - All 4 error codes produceable from dispatcher
  </success_criteria>
  <done>Dispatcher fully tested with native-first fallback logic</done>
</task>

<task type="tdd" id="03-02">
  <name>TDD: sysint MCP tool (list/info/run)</name>
  <files>
    src/tools/sysint.ts
    src/tools/__tests__/sysint.test.ts
  </files>
  <feature>
    <name>sysint MCP dispatcher (list/info/run actions)</name>
    <files>src/tools/sysint.ts, src/tools/__tests__/sysint.test.ts</files>
    <behavior>
      sysint({ action: 'list' }) → createJsonResponse({ total, categories, tools: [...] })
      - Each tool has: id, name, category, description, adminRequired, native (new field vs nirsoft)
      - category filter: sysint({ action: 'list', category: 'network' }) → only network tools

      sysint({ action: 'list', category: 'invalid' }) → createJsonResponse({ total: 0, tools: [] })
      (no error — empty result for unknown category)

      sysint({ action: 'info', id: 'cports' }) → createJsonResponse(tool definition with all fields)
      sysint({ action: 'info' }) → createErrorResponse('id required for info')
      sysint({ action: 'info', id: 'notexist' }) → createErrorResponse('Tool not found: notexist')

      sysint({ action: 'run', id: 'cports' }) → delegates to runTool() from dispatcher.ts
      sysint({ action: 'run' }) → createErrorResponse('id required for run')

      Arg validation (Zod):
      - Missing action → validation error
      - Invalid action → validation error
      - tool alias: { action: 'run', tool: 'cports' } equivalent to { action: 'run', id: 'cports' }
      - format default: 'json' when not provided
    </behavior>
    <implementation>
      1. SysIntArgsSchema (Zod): action enum, id optional, tool optional (alias), category optional, format default 'json', args array optional
         - .transform: id = id ?? tool (alias normalization)
      2. handleList(): getCatalog() → filter → return list with native field included
      3. handleInfo(): findTool() → return full definition → createJsonResponse
      4. handleRun(): validate id → runTool() → createJsonResponse(result) or createErrorResponse(error)
      5. sysintTools: ToolDefinition[] export (array with single 'sysint' tool definition)
      6. Handler wraps all with withErrorHandling() from utils/common.ts
    </implementation>
  </feature>
  <verification>npx vitest run src/tools/__tests__/sysint.test.ts --reporter=verbose</verification>
  <success_criteria>
    - list action returns native field (not in nirsoft list)
    - tool alias for id works
    - format defaults to 'json' without explicit arg
    - All error paths return createErrorResponse (not throws)
  </success_criteria>
  <done>sysint tool fully tested</done>
</task>

<task type="auto" id="03-03">
  <name>Register sysint in toolRegistry.ts and index.ts</name>
  <files>src/toolRegistry.ts, src/index.ts</files>
  <action>
    1. In src/toolRegistry.ts, add sysint entry to FEATURE_TOOL_MAP:
    ```typescript
    sysint: {
      modulePath: './tools/sysint.js',
      exportName: 'sysintTools',
      nativeDeps: [],
      core: false,
      featureName: 'sysint'
    },
    ```

    2. Add sysint placeholder to FEATURE_TOOL_METADATA:
    ```typescript
    sysint: [
      {
        name: 'sysint',
        description: 'Cross-platform system intelligence tools (250 tools). Actions: list, info, run. Native TypeScript implementation, works on Windows, Linux, and WSL.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'info', 'run'], description: 'list: show all tools, info: get tool details, run: execute a tool' },
            id: { type: 'string', description: 'Tool ID (e.g. cports, netstat, tcpview)' },
            tool: { type: 'string', description: 'Alias for id' },
            category: { type: 'string', description: 'Filter by category: network, process, disk, system, browser, password, registry, outlook, audio, programmer' },
            format: { type: 'string', enum: ['json', 'csv', 'raw'], description: 'Output format (default: json)' },
            args: { type: 'array', items: { type: 'string' }, description: 'Additional arguments for run action' },
          },
          required: ['action'],
        },
      },
    ],
    ```

    3. In src/index.ts TOOL_MODULES array, add:
    ```typescript
    { path: './tools/sysint.js', export: 'sysintTools' },
    ```
    Add it immediately after the nirsoft entry for logical grouping.

    DO NOT modify any existing entries — only add new ones.
  </action>
  <verify>
    cd /mnt/c/dev/HakanMCP && npx tsc --noEmit 2>&1 | head -20
    # Should compile without errors
  </verify>
  <done>sysint registered in toolRegistry.ts and index.ts, TypeScript compiles clean</done>
</task>

<task type="auto" id="03-04">
  <name>Run full test suite and verify phase success criteria</name>
  <files></files>
  <action>
    1. Run the full sysint test suite:
    ```bash
    cd /mnt/c/dev/HakanMCP && npx vitest run src/services/sysint/ src/tools/__tests__/sysint.test.ts --reporter=verbose
    ```

    2. Verify Phase 0 success criteria:
    ```bash
    # SC1: sysint list returns catalog (check catalog.json tool count)
    python3 -c "import json; c=json.load(open('data/sysint/catalog.json')); print(f'SC1: {len(c[\"tools\"])} tools in catalog')"

    # SC2: Test that info action returns schema fields
    grep -r "platforms\|adminRequired\|native" src/tools/__tests__/sysint.test.ts && echo "SC2: info returns platform+privilege fields verified in tests"

    # SC3: Output shape test (schema_version not required in v1, just rows/count/timestamp/platform/tool)
    grep -r "rows.*count.*timestamp.*platform" src/services/sysint/__tests__/ && echo "SC3: output contract verified in tests"

    # SC4: Privilege fail-fast
    grep -r "PRIVILEGE_REQUIRED" src/services/sysint/__tests__/ && echo "SC4: privilege fail-fast verified in tests"

    # SC5: WSL path normalization
    grep -r "toWSLPath\|/mnt/c" src/services/sysint/__tests__/pathHelper.test.ts && echo "SC5: WSL path normalization verified in tests"
    ```

    3. Run TypeScript compile check:
    ```bash
    cd /mnt/c/dev/HakanMCP && npx tsc --noEmit
    ```

    If any test fails or TypeScript has errors, fix before reporting done.
  </action>
  <verify>
    All vitest tests pass (0 failures)
    npx tsc --noEmit exits with code 0
  </verify>
  <done>All Phase 0 tests passing, TypeScript compiles clean, 5 success criteria verified</done>
</task>

</tasks>

<verification>
npx vitest run src/services/sysint/ src/tools/__tests__/sysint.test.ts --reporter=verbose && npx tsc --noEmit
</verification>

<must_haves>
- sysint tool lists all 250 tools from catalog including `native` field
- sysint tool API shape mirrors nirsoft exactly (same actions, same arg names)
- Dispatcher guard sequence: NOT_FOUND → PLATFORM_UNSUPPORTED → PRIVILEGE_REQUIRED (in this order)
- Category module Promise-caching prevents duplicate imports on parallel calls
- FEATURE_TOOL_METADATA entry for sysint present (tool appears in list before first invocation)
- TypeScript compiles without errors
- Existing nirsoft tool NOT modified
- Phase 0 success criteria 1-5 all verified by tests or explicit checks
</must_haves>
