---
phase: 00-foundation
plan: 02
wave: 1
type: tdd
depends_on: []
files_modified:
  - src/services/sysint/outputFormatter.ts
  - src/services/sysint/privilegeHelper.ts
  - src/services/sysint/pathHelper.ts
  - src/services/sysint/__tests__/outputFormatter.test.ts
  - src/services/sysint/__tests__/privilegeHelper.test.ts
  - src/services/sysint/__tests__/pathHelper.test.ts
autonomous: true
requirements:
  - FND-03
  - FND-05
  - FND-06
---

<objective>
Implement the three utility helper modules: output formatter, privilege helper, and path helper. These are pure functions and ideal TDD candidates — all have defined inputs/outputs and no side effects except privilege detection (which is mocked in tests).

Purpose: TDD ensures the output contract (error codes, success shape) and path conversion logic are airtight before the MCP dispatcher uses them.

Output: Three tested utility modules with zero coupling to each other.
</objective>

<context>
@.planning/phases/00-foundation/00-CONTEXT.md
@.planning/phases/00-foundation/00-RESEARCH.md
@src/services/nirsoft/platform.ts
@src/services/nirsoft/tempFile.ts
@src/utils/common.ts
@src/types/index.ts
</context>

<tasks>

<task type="tdd" id="02-01">
  <name>TDD: Output formatter</name>
  <files>
    src/services/sysint/outputFormatter.ts
    src/services/sysint/__tests__/outputFormatter.test.ts
  </files>
  <feature>
    <name>Output formatter — buildSuccess, buildError, toCSV</name>
    <files>src/services/sysint/outputFormatter.ts, src/services/sysint/__tests__/outputFormatter.test.ts</files>
    <behavior>
      buildSuccess(rows, toolId, platform) → SysIntSuccess:
      - rows=[], toolId='cports', platform='win32' → { rows: [], count: 0, timestamp: ISO8601, platform: 'win32', tool: 'cports' }
      - rows=[{a:1},{a:2}] → count: 2
      - timestamp is valid ISO8601 string (parseable by new Date())

      buildError(message, code, toolId) → SysIntError:
      - ('requires admin', 'PRIVILEGE_REQUIRED', 'cports') → { error: 'requires admin', code: 'PRIVILEGE_REQUIRED', tool: 'cports' }
      - All 4 error codes accepted: PLATFORM_UNSUPPORTED, PRIVILEGE_REQUIRED, NOT_FOUND, EXEC_FAILED

      toCSV(rows):
      - [] → ''
      - [{ name: 'foo', pid: 123 }] → 'name,pid\nfoo,123'
      - [{ name: 'with,comma' }] → 'name\n"with,comma"' (quoted)
      - [{ name: 'with"quote' }] → 'name\n"with""quote"' (escaped quote)
      - CRLF in value normalized to LF in output

      Platform value: 'wsl' is valid (not just 'win32'|'linux')
    </behavior>
    <implementation>
      1. SysIntSuccess interface: { rows, count, timestamp, platform, tool }
      2. SysIntError interface: { error, code, tool } with code union type
      3. buildSuccess(): creates success object, derives count from rows.length, timestamp = new Date().toISOString()
      4. buildError(): creates error object, validates code is one of 4 values
      5. toCSV(): extracts headers from first row, maps values, quotes fields containing comma/quote/newline
      6. Export Zod schemas: SysIntSuccessSchema, SysIntErrorSchema for runtime validation
    </implementation>
  </feature>
  <verification>npm test -- --testPathPattern=outputFormatter --verbose</verification>
  <success_criteria>
    - All buildSuccess, buildError, toCSV cases pass
    - CSV edge cases (commas, quotes, CRLF) covered
    - Platform='wsl' accepted
  </success_criteria>
  <done>Output formatter fully tested</done>
</task>

<task type="tdd" id="02-02">
  <name>TDD: Privilege helper</name>
  <files>
    src/services/sysint/privilegeHelper.ts
    src/services/sysint/__tests__/privilegeHelper.test.ts
  </files>
  <feature>
    <name>Privilege detection and fail-fast guards</name>
    <files>src/services/sysint/privilegeHelper.ts, src/services/sysint/__tests__/privilegeHelper.test.ts</files>
    <behavior>
      requirePrivilege(tool, toolId) → null | SysIntError:
      - tool.adminRequired=false → null (no error)
      - tool.adminRequired=true + admin → null (allowed)
      - tool.adminRequired=true + non-admin → SysIntError { code: 'PRIVILEGE_REQUIRED', tool: toolId }

      requirePlatform(tool, toolId, currentPlatform) → null | SysIntError:
      - tool.platforms includes currentPlatform → null
      - tool.platforms=['win32'] + currentPlatform='linux' → SysIntError { code: 'PLATFORM_UNSUPPORTED' }
      - tool.platforms=['win32'] + currentPlatform='wsl' → null (WSL can use Windows tools)
      - tool.platforms=['win32','linux'] + currentPlatform='linux' → null

      getPrivilegeLevel() (async, singleton):
      - Returns 'admin' | 'user' | 'unknown'
      - Caches result after first call
      - _resetPrivilegeLevel() clears cache for tests
    </behavior>
    <implementation>
      1. PrivilegeLevel type: 'admin' | 'user' | 'unknown'
      2. getPrivilegeLevel(): cached async detection
         - process.platform === 'win32': PowerShell IsInRole(Administrator) check
         - Linux: process.getuid?.() === 0 → 'admin' else 'user'
         - WSL: Linux detection for Linux-side privilege (root=admin); PowerShell check if needed for Windows-side
         - Any detection failure → 'unknown'
      3. requirePrivilege(tool, toolId): call getPrivilegeLevel(), return null or error
      4. requirePlatform(tool, toolId, currentPlatform): check tool.platforms, WSL special case
      5. _resetPrivilegeLevel() export for tests
      6. Tests mock getPrivilegeLevel() to avoid real system calls
    </implementation>
  </feature>
  <verification>npm test -- --testPathPattern=privilegeHelper --verbose</verification>
  <success_criteria>
    - requirePrivilege cases all pass with mocked privilege level
    - requirePlatform WSL special case verified (WSL can use Windows tools)
    - Cache reset verified
  </success_criteria>
  <done>Privilege helper fully tested</done>
</task>

<task type="tdd" id="02-03">
  <name>TDD: Path helper</name>
  <files>
    src/services/sysint/pathHelper.ts
    src/services/sysint/__tests__/pathHelper.test.ts
  </files>
  <feature>
    <name>Cross-platform path normalization</name>
    <files>src/services/sysint/pathHelper.ts, src/services/sysint/__tests__/pathHelper.test.ts</files>
    <behavior>
      toWSLPath(windowsPath) → string:
      - 'C:\\Users\\Hakan' → '/mnt/c/Users/Hakan'
      - 'C:\\' → '/mnt/c/'
      - 'D:\\Work\\project' → '/mnt/d/Work/project'
      - Drive letter case insensitive: 'c:\\' → '/mnt/c/'
      - Non-Windows path passed through: '/home/user' → '/home/user'

      normalizePath(p) → string:
      - On win32 (mocked): '/foo/bar' → '\\foo\\bar'
      - On linux (mocked): 'C:\\foo\\bar' → 'C:/foo/bar'

      getHomedir() → string:
      - Returns process.env.HOME or process.env.USERPROFILE or '/'

      getTempdir() → string:
      - Returns process.env.TEMP or process.env.TMP or '/tmp'

      toWindowsPath re-export:
      - Import from src/services/nirsoft/platform.ts and re-export
      - Do NOT re-implement
    </behavior>
    <implementation>
      1. toWSLPath(windowsPath): regex /^([A-Za-z]):\\(.*)/ → /mnt/${drive}/${rest.replace(/\\/g, '/')}
      2. normalizePath(p): process.platform check → replace separators
      3. getHomedir(): env var chain
      4. getTempdir(): env var chain
      5. Re-export toWindowsPath from nirsoft/platform.ts
    </implementation>
  </feature>
  <verification>npm test -- --testPathPattern=pathHelper --verbose</verification>
  <success_criteria>
    - All toWSLPath conversion cases pass
    - toWindowsPath is a re-export (not re-implementation) — verify by checking import source
    - Drive letter case normalization verified
  </success_criteria>
  <done>Path helper fully tested</done>
</task>

</tasks>

<verification>
npm test -- --testPathPattern="outputFormatter|privilegeHelper|pathHelper" --verbose
</verification>

<must_haves>
- buildSuccess() count always equals rows.length (never passed manually)
- buildError() only accepts the 4 defined error codes
- requirePlatform(): WSL platform can use Windows-only tools (special case)
- toWSLPath() handles drive letter case insensitivity
- toWindowsPath is a re-export from nirsoft, not a re-implementation
- All helpers have _reset functions for test isolation where state is cached
</must_haves>
